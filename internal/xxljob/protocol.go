package xxljob

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// LoginFamily selects the login route. 2.3.1-3.1.0 posts to /login, 3.2.0+ posts
// to /auth/doLogin with the xxl-sso token.
type LoginFamily string

const (
	LoginLegacy LoginFamily = "legacy"
	LoginSSO    LoginFamily = "sso"
)

// PaginationFamily selects the paging parameters and the single-record
// operation parameter name. 3.2.0-3.2.x already uses /auth/doLogin but still
// pages with start/length, so these two axes are deliberately independent.
type PaginationFamily string

const (
	PageStartLength    PaginationFamily = "start_length"
	PageOffsetPageSize PaginationFamily = "offset_pagesize"
)

// FieldEra selects the request filter names and the response field names.
// 3.5.0 renamed xxl_job_group.title to name and xxl_job_info.job_desc to name;
// up to 3.4.2 the old names are still what the admin binds.
type FieldEra string

const (
	FieldLegacy  FieldEra = "legacy"
	FieldRenamed FieldEra = "renamed"
)

// Stack is the detected protocol combination.
type Stack struct {
	Login      LoginFamily
	Pagination PaginationFamily
	Fields     FieldEra
}

// legacyStack is the documented fallback when detection cannot decide.
func legacyStack() Stack {
	return Stack{Login: LoginLegacy, Pagination: PageStartLength, Fields: FieldLegacy}
}

// FamilyLabel renders the stack the way the connection detail shows it.
func (s Stack) FamilyLabel() string {
	switch s.Login {
	case LoginLegacy:
		if s.Pagination == PageOffsetPageSize {
			return "2.x/3.3+"
		}
		return "2.x"
	case LoginSSO:
		if s.Pagination == PageOffsetPageSize {
			return "3.3+"
		}
		return "3.2.x"
	default:
		return "unknown"
	}
}

// usesBatchIDs reports whether start/stop take ids[] instead of a bare id.
func (s Stack) usesBatchIDs() bool { return s.Pagination == PageOffsetPageSize }

// adminEnvelope decodes both response shells: ReturnT{code,msg,content} up to
// 3.2.x and Response{code,msg,data,success} from 3.3.0.
type adminEnvelope struct {
	// Code is a pointer because not every route answers with an envelope: the
	// 2.x paging endpoints return the DataTables object at the top level and
	// carry no code at all. A plain int would read that as code 0 and report a
	// healthy connection as an admin error.
	Code    *int            `json:"code"`
	Msg     string          `json:"msg"`
	Message string          `json:"message"`
	Content json.RawMessage `json:"content"`
	Data    json.RawMessage `json:"data"`
}

// succeeded reports whether the response is a success. An absent code means the
// route answered with a bare payload rather than an envelope, which is a
// success as far as every version we support is concerned.
func (e adminEnvelope) succeeded() bool { return e.Code == nil || *e.Code == http.StatusOK }

// code returns the envelope code, treating a payload without an envelope as
// the success it is.
func (e adminEnvelope) code() int {
	if e.Code == nil {
		return http.StatusOK
	}
	return *e.Code
}

func (e adminEnvelope) text() string {
	if strings.TrimSpace(e.Msg) != "" {
		return e.Msg
	}
	return e.Message
}

// payload prefers content and falls back to data so one decoder serves every
// supported version.
func (e adminEnvelope) payload() json.RawMessage {
	if isPresentPayload(e.Content) {
		return e.Content
	}
	return e.Data
}

func isPresentPayload(raw json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(raw))
	return trimmed != "" && trimmed != "null"
}

func decodeEnvelope(body []byte) (adminEnvelope, error) {
	var envelope adminEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return adminEnvelope{}, err
	}
	return envelope, nil
}

// pageEnvelope decodes both paging shells. 2.x returns the page object at the
// top of content with recordsTotal; 3.3+ nests the same object under data using
// total. Both keep the rows under "data".
type pageEnvelope[T any] struct {
	RecordsTotal    int `json:"recordsTotal"`
	RecordsFiltered int `json:"recordsFiltered"`
	Total           int `json:"total"`
	Offset          int `json:"offset"`
	PageSize        int `json:"pagesize"`
	Rows            []T `json:"data"`
}

func decodePage[T any](payload json.RawMessage) (PageResult[T], error) {
	result := PageResult[T]{Rows: []T{}}
	if !isPresentPayload(payload) {
		return result, nil
	}
	var envelope pageEnvelope[T]
	if err := json.Unmarshal(payload, &envelope); err == nil {
		total := envelope.RecordsTotal
		if total == 0 {
			total = envelope.Total
		}
		if envelope.Rows == nil {
			envelope.Rows = []T{}
		}
		result.Total = total
		result.Size = envelope.PageSize
		// The 2.x shell has no pagesize, so the page index cannot be derived
		// from the payload; the caller already knows which page it asked for.
		result.Page = 1
		if envelope.PageSize > 0 {
			result.Page = envelope.Offset/envelope.PageSize + 1
		}
		result.Rows = envelope.Rows
		return result, nil
	}
	// Some deployments return the row array without the page wrapper.
	var rows []T
	if err := json.Unmarshal(payload, &rows); err == nil {
		result.Rows = rows
		result.Total = len(rows)
		return result, nil
	}
	return result, newValidationError("payload", "unrecognized page payload")
}

// GroupListRequest filters the executor list. Empty strings mean "no filter",
// but XXL-JOB still requires the parameters to be present.
type GroupListRequest struct {
	Page    int
	Size    int
	AppName string
	Title   string
}

// JobListRequest filters the task list. Every filter must be sent even when
// blank; the admin rejects the call otherwise.
type JobListRequest struct {
	Page            int
	Size            int
	JobGroup        int
	TriggerStatus   int
	Name            string
	ExecutorHandler string
	Author          string
}

// LogListRequest filters the schedule log list.
type LogListRequest struct {
	Page       int
	Size       int
	JobGroup   int
	JobID      int
	LogStatus  int
	FilterTime string
}

// Protocol is the version-neutral admin surface. Implementations differ only in
// parameter names and response shells. The mutation half (declared on
// jobMutator) is part of the same surface: every stack routes add/update/delete
// to its own route family.
type Protocol interface {
	ListJobGroups(ctx context.Context, req GroupListRequest) (PageResult[JobGroup], error)
	LoadJobGroup(ctx context.Context, id int) (JobGroup, error)
	ListJobs(ctx context.Context, req JobListRequest) (PageResult[JobInfo], error)
	TriggerJob(ctx context.Context, jobID int, executorParam string) (string, error)
	StartJobs(ctx context.Context, ids []int) error
	StopJobs(ctx context.Context, ids []int) error
	NextTriggerTimes(ctx context.Context, scheduleType, scheduleConf string) ([]string, error)
	ListLogs(ctx context.Context, req LogListRequest) (PageResult[JobLog], error)
	LogDetail(ctx context.Context, logID, fromLineNum int) (LogDetail, error)
	LogKill(ctx context.Context, logID int) error

	CreateJob(ctx context.Context, job JobMutation) (int, error)
	UpdateJob(ctx context.Context, job JobMutation) error
	DeleteJobs(ctx context.Context, ids []int) error
	CreateJobGroup(ctx context.Context, group GroupMutation) (int, error)
	UpdateJobGroup(ctx context.Context, group GroupMutation) error
	DeleteJobGroups(ctx context.Context, ids []int) error
	SaveGlueSource(ctx context.Context, jobID int, glueSource, glueRemark string) error
}

// stackProtocol routes each call to the matching stack behaviour. Everything
// shared (envelope, paging, retry) lives here; only parameter names differ.
type stackProtocol struct {
	client *Client
	stack  Stack
}

// NewProtocol binds the detected stack to a protocol implementation.
func (c *Client) NewProtocol() Protocol {
	return &stackProtocol{client: c, stack: c.stackSnapshot()}
}

func (p *stackProtocol) applyPaging(values url.Values, page, size int) {
	page = normalizePage(page)
	size = normalizePageSize(size)
	if p.stack.Pagination == PageOffsetPageSize {
		values.Set("offset", strconv.Itoa((page-1)*size))
		values.Set("pagesize", strconv.Itoa(size))
		return
	}
	values.Set("start", strconv.Itoa((page-1)*size))
	values.Set("length", strconv.Itoa(size))
}

// applyID writes the single-record parameter in the shape the stack expects.
func (p *stackProtocol) applyID(values url.Values, id int) {
	if p.stack.usesBatchIDs() {
		values.Add("ids[]", strconv.Itoa(id))
		return
	}
	values.Set("id", strconv.Itoa(id))
}

// applyGroupFilter writes the executor filter. Up to 3.4.2 the admin binds
// "title"; 3.5.0 binds "name".
func (p *stackProtocol) applyGroupFilter(values url.Values, appName, title string) {
	values.Set("appname", appName)
	if p.stack.Fields == FieldRenamed {
		values.Set("name", title)
		return
	}
	values.Set("title", title)
}

// applyJobFilter writes the task filters. XXL-JOB requires every one of them to
// be present; an omitted parameter is treated as an invalid request, so blank
// values are sent as empty strings rather than dropped.
func (p *stackProtocol) applyJobFilter(values url.Values, req JobListRequest) {
	values.Set("jobGroup", strconv.Itoa(req.JobGroup))
	values.Set("triggerStatus", strconv.Itoa(req.TriggerStatus))
	values.Set("executorHandler", req.ExecutorHandler)
	values.Set("author", req.Author)
	if p.stack.Fields == FieldRenamed {
		values.Set("name", req.Name)
		return
	}
	values.Set("jobDesc", req.Name)
}

func normalizePage(page int) int {
	if page < 1 {
		return 1
	}
	return page
}

func normalizePageSize(size int) int {
	switch {
	case size <= 0:
		return defaultPageSize
	case size > maxPageSize:
		return maxPageSize
	default:
		return size
	}
}

// callAPI performs one logical admin call: it guarantees a session, executes
// the request, and retries exactly once after transparently re-authenticating
// when the session expired.
func (c *Client) callAPI(
	ctx context.Context,
	method string,
	apiPath string,
	form url.Values,
	query url.Values,
) (adminEnvelope, error) {
	for attempt := 0; attempt < 2; attempt++ {
		if err := c.ensureLoggedIn(ctx); err != nil {
			return adminEnvelope{}, err
		}
		requestCtx, cancel := c.requestTimeout(ctx)
		raw, err := c.do(requestCtx, method, apiPath, form, query)
		cancel()
		if err != nil {
			return adminEnvelope{}, err
		}
		expired, terminal := classifyRaw(raw)
		if expired {
			if attempt == 0 {
				c.invalidateSession()
				continue
			}
			return adminEnvelope{}, &SessionExpiredError{}
		}
		if terminal != nil {
			return adminEnvelope{}, terminal
		}
		envelope, decodeErr := decodeEnvelope(raw.body)
		if decodeErr != nil {
			if raw.status != http.StatusOK {
				return adminEnvelope{}, &HTTPStatusError{Status: raw.status, Body: string(raw.body)}
			}
			return adminEnvelope{}, localizedXxlJobErrorWithCause(
				"xxljob.backend.error.invalid_response", nil, decodeErr)
		}
		if envelope.succeeded() {
			return envelope, nil
		}
		if sessionExpiredFromEnvelope(envelope.code(), envelope.text()) {
			if attempt == 0 {
				c.invalidateSession()
				continue
			}
			return adminEnvelope{}, &SessionExpiredError{}
		}
		return adminEnvelope{}, remoteError(envelope.code(), envelope.text())
	}
	return adminEnvelope{}, &SessionExpiredError{}
}

// classifyRaw separates transport-level redirects and statuses from JSON
// envelopes. expired marks both shapes of an unauthenticated response.
func classifyRaw(raw rawResponse) (expired bool, terminal error) {
	if isRedirectStatus(raw.status) {
		if sessionExpiredFromRedirect(raw.location) {
			return true, nil
		}
		return false, &HTTPStatusError{Status: raw.status, Body: raw.location}
	}
	if raw.status != http.StatusOK {
		return false, &HTTPStatusError{Status: raw.status, Body: string(raw.body)}
	}
	return false, nil
}
