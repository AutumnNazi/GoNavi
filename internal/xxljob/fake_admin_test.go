package xxljob

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
)

// adminFlavor describes one supported XXL-JOB response dialect.
type adminFlavor struct {
	name       string
	login      LoginFamily
	pagination PaginationFamily
	fields     FieldEra
	// requiredGroupFilters lists the group paging parameters the upstream
	// admin binds as required request parameters: a request without them is
	// answered with HTTP 400. 3.0-3.2.x do, 2.4.1 and 3.3.0+ do not.
	requiredGroupFilters []string
	// requiredJobFilters lists the jobinfo paging parameters the upstream
	// admin binds as required request parameters.
	requiredJobFilters []string
}

// The three dialects the first version targets: the legacy line, the 3.2.x
// transition (new login, old paging), and 3.5.0 (new login, new paging, renamed
// fields).
var (
	flavor2x = adminFlavor{
		name: "2.x", login: LoginLegacy, pagination: PageStartLength, fields: FieldLegacy,
		requiredGroupFilters: nil,
		requiredJobFilters:   []string{"jobGroup", "triggerStatus"},
	}
	flavor32x = adminFlavor{
		name: "3.2.x", login: LoginSSO, pagination: PageStartLength, fields: FieldLegacy,
		requiredGroupFilters: []string{"appname", "title"},
		requiredJobFilters:   []string{"jobGroup", "triggerStatus", "jobDesc", "executorHandler", "author"},
	}
	flavor35 = adminFlavor{
		name: "3.5.0", login: LoginSSO, pagination: PageOffsetPageSize, fields: FieldRenamed,
		requiredGroupFilters: nil,
		requiredJobFilters:   []string{"jobGroup", "triggerStatus", "name", "executorHandler", "author"},
	}
	allFlavors = []adminFlavor{flavor2x, flavor32x, flavor35}
)

// expiryShape selects how an expired session is reported.
type expiryShape string

// Route expectations per flavor: the stack decides which mutation route the
// protocol must hit. The add→insert and remove→delete renames landed with
// 3.3.0, so a 3.2.x admin still answers the 2.x route names.
func (f adminFlavor) jobCreateRoute() string {
	if f.pagination == PageOffsetPageSize {
		return route3JobInfoInsert
	}
	return route2JobInfoAdd
}

func (f adminFlavor) jobUpdateRoute() string {
	if f.login == LoginSSO {
		return route3JobInfoUpdate
	}
	return route2JobInfoSave
}

func (f adminFlavor) jobDeleteRoute() string {
	if f.pagination == PageOffsetPageSize {
		return route3JobInfoDelete
	}
	return route2JobInfoRemove
}

func (f adminFlavor) groupCreateRoute() string {
	if f.pagination == PageOffsetPageSize {
		return route3JobGroupInsert
	}
	return route2JobGroupSave
}

func (f adminFlavor) groupUpdateRoute() string {
	if f.login == LoginSSO {
		return route3JobGroupUpdate
	}
	return route2JobGroupUpdate
}

const (
	expiryRedirect302 expiryShape = "redirect302"
	expiryCode500     expiryShape = "code500"
)

type recordedCall struct {
	Path string
	Form url.Values
	Auth bool
}

// fakeAdmin is a configurable stand-in for xxl-job-admin. It records every call
// so tests can assert on the exact parameters each stack produced.
type fakeAdmin struct {
	t           *testing.T
	flavor      adminFlavor
	server      *httptest.Server
	contextPath string

	mu              sync.Mutex
	calls           []recordedCall
	cookie          string
	authedCalls     int
	expiry          expiryShape
	expireAfter     int
	forwardFail     bool
	rejectLogin     bool
	loginFailureMsg string
	businessError   string
	customLoginPage bool
	forwardDetail   string
	logDetailBody   string
	groupsTotal     int
	jobsTotal       int
	logsTotal       int
	// jobIDs turns the task listing into a synthetic list of that many tasks
	// so a test can place a task on a later page.
	jobIDs []int
}

// setGroupsTotal sets the total the admin reports for the executor listing.
func (a *fakeAdmin) setGroupsTotal(total int) {
	a.mu.Lock()
	a.groupsTotal = total
	a.mu.Unlock()
}

// setJobIDs replaces the task listing with a synthetic list of those ids.
func (a *fakeAdmin) setJobIDs(ids []int) {
	a.mu.Lock()
	a.jobIDs = append([]int(nil), ids...)
	a.mu.Unlock()
}

func newFakeAdmin(t *testing.T, flavor adminFlavor, contextPath string) *fakeAdmin {
	t.Helper()
	admin := &fakeAdmin{
		t:             t,
		flavor:        flavor,
		contextPath:   strings.TrimSuffix(contextPath, "/"),
		groupsTotal:   1,
		jobsTotal:     1,
		logsTotal:     1,
		logDetailBody: `{"fromLineNum":1,"toLineNum":2,"logContent":"hello\n","isEnd":true}`,
	}
	admin.server = httptest.NewServer(http.HandlerFunc(admin.serve))
	t.Cleanup(admin.server.Close)
	return admin
}

func (a *fakeAdmin) hostPort() (string, int) {
	trimmed := strings.TrimPrefix(a.server.URL, "http://")
	parts := strings.Split(trimmed, ":")
	port := 0
	fmt.Sscanf(parts[len(parts)-1], "%d", &port)
	return strings.Join(parts[:len(parts)-1], ":"), port
}

// testConfig builds a connection config pointing at the fake admin.
func (a *fakeAdmin) testConfig(t *testing.T) connection.ConnectionConfig {
	t.Helper()
	host, port := a.hostPort()
	cfg := connection.ConnectionConfig{
		Type:     "xxljob",
		Host:     host,
		Port:     port,
		User:     "admin",
		Password: "123456",
		Timeout:  10,
	}
	if a.contextPath != "" {
		cfg.ConnectionParams = "contextPath=" + url.QueryEscape(a.contextPath)
	}
	return cfg
}

func (a *fakeAdmin) recorded() []recordedCall {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]recordedCall, len(a.calls))
	copy(out, a.calls)
	return out
}

func (a *fakeAdmin) lastCallTo(path string) (recordedCall, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for i := len(a.calls) - 1; i >= 0; i-- {
		if a.calls[i].Path == path {
			return a.calls[i], true
		}
	}
	return recordedCall{}, false
}

func (a *fakeAdmin) expireSessions(shape expiryShape, afterAuthenticatedCalls int) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.expiry = shape
	a.expireAfter = afterAuthenticatedCalls
}

// redirectToCustomPage makes the unauthenticated root answer with an unrelated
// login page, which is how a deployment defeats the version probe.
func (a *fakeAdmin) redirectToCustomPage() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.customLoginPage = true
}

// rejectLogins makes every login attempt fail, modelling an admin whose
// session store was cleared underneath the client.
func (a *fakeAdmin) rejectLogins(reject bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.rejectLogin = reject
}

// rejectLoginsWith makes every login attempt fail with a specific admin
// message. The default rejection is a credential error; an admin that reports
// an expired session instead answers with a different text, and the two must
// not reach the user as the same problem.
func (a *fakeAdmin) rejectLoginsWith(message string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.rejectLogin = true
	a.loginFailureMsg = message
}

// nextBusinessError makes the next ordinary endpoint answer with a non-auth
// code 500, which must not look like an expired session.
func (a *fakeAdmin) nextBusinessError(message string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.businessError = message
}

// failExecutorForward makes the admin answer the two proxied endpoints with a
// business error, which is what an unreachable executor looks like.
func (a *fakeAdmin) failExecutorForward(detail string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.forwardFail = true
	a.forwardDetail = detail
}

func (a *fakeAdmin) serve(w http.ResponseWriter, r *http.Request) {
	form := url.Values{}
	if r.Method == http.MethodPost {
		_ = r.ParseForm()
		form = r.PostForm
	}
	a.mu.Lock()
	a.calls = append(a.calls, recordedCall{Path: r.URL.Path, Form: form, Auth: a.cookie != ""})
	hasCookie := a.cookie != "" && r.Header.Get("Cookie") != ""
	a.authedCalls++
	authedCalls := a.authedCalls
	expired := a.expiry != "" && a.expireAfter > 0 && authedCalls > a.expireAfter
	shape := a.expiry
	forwardFail := a.forwardFail
	forwardDetail := a.forwardDetail
	logDetailBody := a.logDetailBody
	businessError := a.businessError
	a.businessError = ""
	a.mu.Unlock()

	if businessError != "" && !isLoginRoute(relativeOf(a.contextPath, r.URL.Path), a.flavor) &&
		relativeOf(a.contextPath, r.URL.Path) != "/joblog/logDetailCat" &&
		relativeOf(a.contextPath, r.URL.Path) != routeJobLogKill {
		a.writeEnvelope(w, http.StatusOK, http.StatusInternalServerError, businessError, nil)
		return
	}

	if r.URL.Path == a.contextPath+"/" || r.URL.Path == a.contextPath {
		a.serveLoginRedirect(w, r)
		return
	}

	relative := strings.TrimPrefix(r.URL.Path, a.contextPath)
	switch relative {
	case a.loginRoute(), route2Login, route3Login:
		a.serveLogin(w, form)
		return
	case route2Logout, route3Logout:
		a.mu.Lock()
		a.cookie = ""
		a.mu.Unlock()
		a.writeEnvelope(w, http.StatusOK, http.StatusOK, "", nil)
		return
	}

	if !hasCookie {
		a.writeUnauthenticated(w, shape)
		return
	}
	if expired {
		a.writeUnauthenticated(w, shape)
		return
	}

	switch relative {
	case routeJobGroupPageList:
		a.serveGroups(w, form)
	case routeJobGroupLoadByID:
		a.serveGroupByID(w, form)
	case routeJobInfoPageList:
		a.serveJobs(w, form)
	case routeJobInfoTrigger:
		a.serveTrigger(w, form)
	case routeJobInfoStart, routeJobInfoStop:
		a.writeEnvelope(w, http.StatusOK, http.StatusOK, "ok", nil)
	case route2JobInfoAdd, route3JobInfoInsert:
		a.writeEnvelope(w, http.StatusOK, http.StatusOK, "Success", "3")
	case route2JobInfoSave, route3JobInfoUpdate:
		a.writeEnvelope(w, http.StatusOK, http.StatusOK, "Success", nil)
	case route2JobInfoRemove, route3JobInfoDelete:
		a.writeEnvelope(w, http.StatusOK, http.StatusOK, "Success", nil)
	case route2JobGroupSave, route3JobGroupInsert:
		a.writeEnvelope(w, http.StatusOK, http.StatusOK, "Success", "7")
	case route2JobGroupUpdate: // 与 route3JobGroupUpdate 同路径，合并 case
		a.writeEnvelope(w, http.StatusOK, http.StatusOK, "Success", nil)
	case route2JobGroupRemove, route3JobGroupDelete:
		a.writeEnvelope(w, http.StatusOK, http.StatusOK, "Success", nil)
	case route3JobCodeSave:
		// The upstream route refuses a blank remark and one outside 4-100
		// characters, and it exists on every supported version (2.3.1 already
		// ships it), so the fake must not accept what the admin rejects.
		remark := form.Get("glueRemark")
		if len([]rune(remark)) < 4 || len([]rune(remark)) > 100 {
			a.writeEnvelope(w, http.StatusOK, http.StatusInternalServerError, "glueRemark limit", nil)
			return
		}
		a.writeEnvelope(w, http.StatusOK, http.StatusOK, "Success", nil)
	case routeJobInfoNextTrigger:
		a.writeArray(w, []string{"2026-10-17 10:00:00", "2026-10-17 10:00:30"})
	case routeJobLogPageList:
		a.serveLogs(w, form)
	case routeJobLogDetailCat:
		if forwardFail {
			a.writeEnvelope(w, http.StatusOK, http.StatusInternalServerError, forwardDetail, nil)
			return
		}
		a.writeRaw(w, logDetailBody)
	case routeJobLogKill:
		if forwardFail {
			a.writeEnvelope(w, http.StatusOK, http.StatusInternalServerError, forwardDetail, nil)
			return
		}
		a.writeEnvelope(w, http.StatusOK, http.StatusOK, "ok", nil)
	default:
		http.NotFound(w, r)
	}
}

func (a *fakeAdmin) loginRoute() string {
	if a.flavor.login == LoginSSO {
		return route3Login
	}
	return route2Login
}

func (a *fakeAdmin) serveLoginRedirect(w http.ResponseWriter, _ *http.Request) {
	a.mu.Lock()
	custom := a.customLoginPage
	a.mu.Unlock()
	if custom {
		w.Header().Set("Location", a.contextPath+"/custom-login")
		w.WriteHeader(http.StatusFound)
		return
	}
	page := route2LoginPage
	if a.flavor.login == LoginSSO {
		page = route3LoginPage
	}
	w.Header().Set("Location", a.contextPath+page)
	w.WriteHeader(http.StatusFound)
}

func (a *fakeAdmin) serveLogin(w http.ResponseWriter, form url.Values) {
	a.mu.Lock()
	rejectLogin := a.rejectLogin
	failureMessage := a.loginFailureMsg
	a.mu.Unlock()
	if failureMessage == "" {
		failureMessage = "user/password error"
	}
	if rejectLogin {
		a.writeEnvelope(w, http.StatusOK, http.StatusInternalServerError, failureMessage, nil)
		return
	}
	if form.Get("userName") != "admin" || form.Get("password") != "123456" {
		a.writeEnvelope(w, http.StatusOK, http.StatusInternalServerError, failureMessage, nil)
		return
	}
	a.mu.Lock()
	a.cookie = "issued"
	a.authedCalls = 0
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: a.sessionCookieName(), Value: "token", Path: "/"})
	a.writeEnvelope(w, http.StatusOK, http.StatusOK, "Success", nil)
}

func (a *fakeAdmin) sessionCookieName() string {
	if a.flavor.login == LoginSSO {
		return "xxl_job_login_token"
	}
	return "XXL_JOB_LOGIN_IDENTITY"
}

// writeUnauthenticated emits the two shapes XXL-JOB uses to reject an
// unauthenticated AJAX call. 2.x redirects, 3.2+ answers 200 with code 500.
func (a *fakeAdmin) writeUnauthenticated(w http.ResponseWriter, shape expiryShape) {
	useRedirect := shape == expiryRedirect302 ||
		(shape == "" && a.flavor.login == LoginLegacy)
	if useRedirect {
		page := route2LoginPage
		if a.flavor.login == LoginSSO {
			page = route3LoginPage
		}
		w.Header().Set("Location", a.contextPath+page)
		w.WriteHeader(http.StatusFound)
		return
	}
	a.writeEnvelope(w, http.StatusOK, http.StatusInternalServerError, "xxl-job login expired, please login again", nil)
}

func (a *fakeAdmin) serveGroups(w http.ResponseWriter, form url.Values) {
	if !writeMissingFilter(w, form, a.flavor.requiredGroupFilters) {
		return
	}
	a.mu.Lock()
	total := a.groupsTotal
	a.mu.Unlock()
	row := a.groupRow()
	a.writePage(w, a.pagingParams(form), []json.RawMessage{row}, total)
}

// writeMissingFilter answers HTTP 400 when a required request parameter is
// missing, which is how the upstream admins reject an incomplete paging call.
func writeMissingFilter(w http.ResponseWriter, form url.Values, required []string) bool {
	for _, key := range required {
		if _, ok := form[key]; !ok {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("<!DOCTYPE html><title>Error</title>Missing request parameter '" + key + "'"))
			return false
		}
	}
	return true
}

func (a *fakeAdmin) groupRow() json.RawMessage {
	if a.flavor.fields == FieldRenamed {
		return json.RawMessage(`{"id":1,"appname":"xxl-job-executor-sample","name":"Sample Executor","addressType":0,"addressList":"","updateTime":1758000000000,"registryList":[{"registryGroup":"xxl-job-executor-sample","registryKey":"http://172.23.0.5:9999/","updateTime":1758000000000}]}`)
	}
	return json.RawMessage(`{"id":1,"appname":"xxl-job-executor-sample","title":"Sample Executor","addressType":0,"addressList":"","updateTime":"2026-10-17 10:00:00","registryList":[{"registryGroup":"xxl-job-executor-sample","registryKey":"http://172.23.0.5:9999/","updateTime":"2026-10-17 10:00:00"}]}`)
}

func (a *fakeAdmin) serveGroupByID(w http.ResponseWriter, form url.Values) {
	// loadById binds a single "id" on every version. The real 3.3+ admin
	// answers with a 400 error page when the parameter is missing, so the fake
	// must not accept ids[] as a stand-in: doing so would hide a client that
	// sends the batch parameter to a single-record route.
	id := form.Get("id")
	if id == "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("<!DOCTYPE html><title>Error</title>missing request parameter 'id'"))
		return
	}
	if id == "0" {
		a.writeEnvelope(w, http.StatusOK, http.StatusInternalServerError, "executor not found", nil)
		return
	}
	a.writeRaw(w, string(a.groupRow()))
}

func (a *fakeAdmin) serveJobs(w http.ResponseWriter, form url.Values) {
	if !writeMissingFilter(w, form, a.flavor.requiredJobFilters) {
		return
	}
	a.mu.Lock()
	total := a.jobsTotal
	ids := append([]int(nil), a.jobIDs...)
	a.mu.Unlock()

	var rows []json.RawMessage
	if len(ids) > 0 {
		rows = a.jobRowsForPage(form, ids)
		total = len(ids)
	} else {
		rows = append(rows, a.jobRowWithID(1))
	}
	a.writePage(w, a.pagingParams(form), rows, total)
}

// jobRowsForPage renders the slice of the synthetic task list the request
// asked for, so a test can put a task on a later page.
func (a *fakeAdmin) jobRowsForPage(form url.Values, ids []int) []json.RawMessage {
	start, size := a.pageWindow(form)
	end := start + size
	if end > len(ids) {
		end = len(ids)
	}
	if start > len(ids) {
		start = len(ids)
	}
	rows := make([]json.RawMessage, 0, end-start)
	for _, id := range ids[start:end] {
		rows = append(rows, a.jobRowWithID(id))
	}
	return rows
}

// pageWindow resolves the requested page window in the flavor's paging shape.
func (a *fakeAdmin) pageWindow(form url.Values) (int, int) {
	if a.flavor.pagination == PageOffsetPageSize {
		size := atoiDefault(form.Get("pagesize"))
		if size <= 0 {
			size = 10
		}
		return atoiDefault(form.Get("offset")), size
	}
	size := atoiDefault(form.Get("length"))
	if size <= 0 {
		size = 10
	}
	return atoiDefault(form.Get("start")), size
}

// jobRowWithID renders one task row carrying the given id.
func (a *fakeAdmin) jobRowWithID(id int) json.RawMessage {
	if a.flavor.fields == FieldRenamed {
		return json.RawMessage(fmt.Sprintf(`{"id":%d,"jobGroup":1,"name":"demoJobHandler","author":"admin","scheduleType":"CRON","scheduleConf":"0/30 * * * * ?","executorHandler":"demoJobHandler","executorParam":"","executorRouteStrategy":"FIRST","executorBlockStrategy":"SERIAL_EXECUTION","executorTimeout":0,"executorFailRetryCount":0,"glueType":"BEAN","triggerStatus":1,"triggerLastTime":1758000000000,"triggerNextTime":1758000030000}`, id))
	}
	return json.RawMessage(fmt.Sprintf(`{"id":%d,"jobGroup":1,"jobDesc":"demoJobHandler","author":"admin","scheduleType":"CRON","scheduleConf":"0/30 * * * * ?","executorHandler":"demoJobHandler","executorParam":"","executorRouteStrategy":"FIRST","executorBlockStrategy":"SERIAL_EXECUTION","executorTimeout":0,"executorFailRetryCount":0,"glueType":"BEAN","triggerStatus":1,"triggerLastTime":"2026-10-17 10:00:00","triggerNextTime":"2026-10-17 10:00:30"}`, id))
}

func (a *fakeAdmin) serveLogs(w http.ResponseWriter, form url.Values) {
	a.mu.Lock()
	total := a.logsTotal
	a.mu.Unlock()
	rows := []json.RawMessage{
		json.RawMessage(`{"id":10,"jobGroup":1,"jobId":1,"executorAddress":"http://172.23.0.5:9999/","executorHandler":"demoJobHandler","executorParam":"","triggerTime":"2026-10-17 10:00:00","triggerCode":200,"triggerMsg":"","handleTime":1758000000000,"handleCode":0,"handleMsg":"","alarmStatus":0}`),
	}
	a.writePage(w, a.pagingParams(form), rows, total)
}

func (a *fakeAdmin) serveTrigger(w http.ResponseWriter, form url.Values) {
	if form.Get("id") == "" {
		a.writeEnvelope(w, http.StatusOK, http.StatusInternalServerError, "job id is required", nil)
		return
	}
	// XXL-JOB returns the dispatch target as the payload itself.
	a.writeEnvelope(w, http.StatusOK, http.StatusOK, "Success", "trigger success: http://172.23.0.5:9999/")
}

// pagingParams echoes the paging parameters the caller actually sent, which is
// what the assertions check.
func (a *fakeAdmin) pagingParams(form url.Values) url.Values {
	out := url.Values{}
	for _, key := range []string{"start", "length", "offset", "pagesize"} {
		if v := form.Get(key); v != "" {
			out.Set(key, v)
		}
	}
	return out
}

// writeEnvelope emits the flavor's shell: content for ReturnT, data for
// Response. The business code is explicit so a success message carrying free
// text is not mistaken for a failure.
func (a *fakeAdmin) writeEnvelope(w http.ResponseWriter, status, code int, msg string, payload any) {
	body := map[string]any{"code": code, "msg": msg}
	if payload != nil {
		if a.flavor.pagination == PageOffsetPageSize {
			body["data"] = payload
		} else {
			body["content"] = payload
		}
	}
	a.writeJSON(w, status, body)
}

func (a *fakeAdmin) writePage(w http.ResponseWriter, params url.Values, rows []json.RawMessage, total int) {
	items := make([]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, row)
	}
	if a.flavor.pagination == PageOffsetPageSize {
		page := map[string]any{
			"offset":   atoiDefault(params.Get("offset")),
			"pagesize": atoiDefault(params.Get("pagesize")),
			"total":    total,
			"data":     items,
		}
		a.writeEnvelope(w, http.StatusOK, http.StatusOK, "Success", page)
		return
	}
	// The 2.x line and 3.0-3.2.x answer the paging routes with a bare
	// DataTables object and no envelope at all: the top-level "data" key is
	// the row array and recordsTotal sits next to it.
	page := map[string]any{
		"recordsTotal":    total,
		"recordsFiltered": total,
		"data":            items,
	}
	a.writeJSON(w, http.StatusOK, page)
}

func (a *fakeAdmin) writeArray(w http.ResponseWriter, values []string) {
	a.writeEnvelope(w, http.StatusOK, http.StatusOK, "Success", values)
}

func (a *fakeAdmin) writeRaw(w http.ResponseWriter, body string) {
	a.writeJSON(w, http.StatusOK, map[string]any{"code": http.StatusOK, "msg": "Success", "content": json.RawMessage(body)})
}

func (a *fakeAdmin) writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func relativeOf(contextPath, path string) string {
	return strings.TrimPrefix(path, contextPath)
}

func isLoginRoute(relative string, flavor adminFlavor) bool {
	if flavor.login == LoginSSO {
		return relative == route3Login
	}
	return relative == route2Login
}

func atoiDefault(raw string) int {
	value := 0
	for _, r := range raw {
		if r < '0' || r > '9' {
			return 0
		}
		value = value*10 + int(r-'0')
	}
	return value
}

func testContext(t *testing.T) (context.Context, context.CancelFunc) {
	t.Helper()
	return context.WithTimeout(t.Context(), 20*time.Second)
}
