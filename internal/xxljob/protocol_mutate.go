package xxljob

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// JobMutation carries every task field the admin's add/update form binds. The
// zero ID means create; a positive ID routes to update. GLUE jobs carry their
// source and remark on the same POJO for both stacks.
type JobMutation struct {
	ID                     int
	JobGroup               int
	Name                   string // 2.x: jobDesc, 3.5.0+: name
	Author                 string
	AlarmEmail             string
	ScheduleType           string
	ScheduleConf           string
	MisfireStrategy        string
	ExecutorRouteStrategy  string
	ExecutorHandler        string
	ExecutorParam          string
	ExecutorBlockStrategy  string
	ExecutorTimeout        int
	ExecutorFailRetryCount int
	GlueType               string
	GlueSource             string
	GlueRemark             string
	ChildJobID             string
	TriggerStatus          int
}

// GroupMutation carries the executor form fields.
type GroupMutation struct {
	ID          int
	AppName     string
	Title       string // 3.5.0+: name
	AddressType int
	AddressList string
}

// The mutation half of Protocol. Declared separately so the read-side surface
// stays legible; both halves are satisfied by the same stackProtocol.
type jobMutator interface {
	CreateJob(ctx context.Context, job JobMutation) (int, error)
	UpdateJob(ctx context.Context, job JobMutation) error
	DeleteJobs(ctx context.Context, ids []int) error
	CreateJobGroup(ctx context.Context, group GroupMutation) (int, error)
	UpdateJobGroup(ctx context.Context, group GroupMutation) error
	DeleteJobGroups(ctx context.Context, ids []int) error
	SaveGlueSource(ctx context.Context, jobID int, glueSource, glueRemark string) error
}

// validate checks the fields the admin itself validates before a task save.
func (m JobMutation) validate() error {
	if m.JobGroup <= 0 {
		return newValidationError("jobGroup", "jobGroup must be positive")
	}
	if strings.TrimSpace(m.Name) == "" {
		return newValidationError("name", "task description is required")
	}
	if strings.TrimSpace(m.ScheduleType) == "" {
		return newValidationError("scheduleType", "scheduleType is required")
	}
	if strings.TrimSpace(m.ScheduleConf) == "" && m.ScheduleType != ScheduleTypeNone {
		return newValidationError("scheduleConf", "scheduleConf is required")
	}
	// GLUE 任务没有 JobHandler（源码即任务体），仅 BEAN 模式必填。
	if m.GlueType == "" || m.GlueType == "BEAN" {
		if strings.TrimSpace(m.ExecutorHandler) == "" {
			return newValidationError("executorHandler", "executorHandler is required")
		}
	}
	// 官方语义：-1 表示沿用调度中心默认（超时 0 秒、不重试），合法值。
	if m.ExecutorTimeout < -1 {
		return newValidationError("executorTimeout", "executorTimeout must not be negative")
	}
	if m.ExecutorFailRetryCount < -1 {
		return newValidationError("executorFailRetryCount", "executorFailRetryCount must not be negative")
	}
	return nil
}

// validate checks the executor form the way the admin does: appname length,
// title presence, and manual addresses that must be a comma list.
func (m GroupMutation) validate() error {
	if len(strings.TrimSpace(m.AppName)) < 4 || len(strings.TrimSpace(m.AppName)) > 64 {
		return newValidationError("appName", "appName must be 4-64 characters")
	}
	if strings.ContainsAny(m.AppName, "<>") {
		return newValidationError("appName", "appName must not contain < or >")
	}
	if strings.TrimSpace(m.Title) == "" {
		return newValidationError("title", "executor title is required")
	}
	if strings.ContainsAny(m.Title, "<>") {
		return newValidationError("title", "executor title must not contain < or >")
	}
	if m.AddressType != 0 && strings.TrimSpace(m.AddressList) == "" {
		return newValidationError("addressList", "manual registration requires addressList")
	}
	return nil
}

// applyJobMutation writes the task POJO fields. Field names stay the official
// ones (jobDesc/author/alarmEmail/...); only the description column changed
// name in 3.5.0, and the group title follows the same era.
func (p *stackProtocol) applyJobMutation(values url.Values, job JobMutation) {
	values.Set("jobGroup", itoa(job.JobGroup))
	if p.stack.Fields == FieldRenamed {
		values.Set("name", job.Name)
	} else {
		values.Set("jobDesc", job.Name)
	}
	values.Set("author", job.Author)
	values.Set("alarmEmail", job.AlarmEmail)
	values.Set("scheduleType", job.ScheduleType)
	values.Set("scheduleConf", job.ScheduleConf)
	values.Set("misfireStrategy", job.MisfireStrategy)
	values.Set("executorRouteStrategy", job.ExecutorRouteStrategy)
	values.Set("executorHandler", job.ExecutorHandler)
	values.Set("executorParam", job.ExecutorParam)
	values.Set("executorBlockStrategy", job.ExecutorBlockStrategy)
	values.Set("executorTimeout", itoa(job.ExecutorTimeout))
	values.Set("executorFailRetryCount", itoa(job.ExecutorFailRetryCount))
	values.Set("glueType", job.GlueType)
	values.Set("glueSource", job.GlueSource)
	values.Set("glueRemark", job.GlueRemark)
	values.Set("childJobId", job.ChildJobID)
	values.Set("triggerStatus", itoa(job.TriggerStatus))
}

// applyGroupMutation writes the executor POJO fields. The title column follows
// the same FieldEra as the task description.
func (p *stackProtocol) applyGroupMutation(values url.Values, group GroupMutation) {
	values.Set("appname", group.AppName)
	if p.stack.Fields == FieldRenamed {
		values.Set("name", group.Title)
	} else {
		values.Set("title", group.Title)
	}
	values.Set("addressType", itoa(group.AddressType))
	values.Set("addressList", group.AddressList)
}

// jobMutateRoute picks add vs update vs save for the stack. The 3.3.0 line
// renamed add to insert and remove to delete; 3.2.x still answers the 2.x
// route names even though it already uses the SSO login. The rename boundary
// is therefore the paging axis (3.3+), not the login family: keying it on
// the login sends every write of a 3.2.x admin to a route it does not bind.
func (p *stackProtocol) jobMutateRoute(create bool) string {
	if create {
		if p.stack.usesBatchIDs() {
			return route3JobInfoInsert
		}
		return route2JobInfoAdd
	}
	if p.stack.Login == LoginSSO {
		return route3JobInfoUpdate
	}
	return route2JobInfoSave
}

// groupMutateRoute mirrors the task naming: 3.3+ insert, earlier lines save.
// The update route is called /jobgroup/update on every supported version.
func (p *stackProtocol) groupMutateRoute(create bool) string {
	if create {
		if p.stack.usesBatchIDs() {
			return route3JobGroupInsert
		}
		return route2JobGroupSave
	}
	return route3JobGroupUpdate
}

// deleteRoute picks the task or executor delete path for the stack. 3.3+
// names it delete and takes ids[], the earlier lines name it remove and take
// a single id.
func (p *stackProtocol) deleteRoute(job bool) string {
	if job {
		if p.stack.usesBatchIDs() {
			return route3JobInfoDelete
		}
		return route2JobInfoRemove
	}
	if p.stack.usesBatchIDs() {
		return route3JobGroupDelete
	}
	return route2JobGroupRemove
}

// CreateJob adds one task and returns the created id when the admin reports it.
func (p *stackProtocol) CreateJob(ctx context.Context, job JobMutation) (int, error) {
	if err := job.validate(); err != nil {
		return 0, err
	}
	values := url.Values{}
	p.applyJobMutation(values, job)

	envelope, err := p.client.callAPI(ctx, http.MethodPost, p.jobMutateRoute(true), values, nil)
	if err != nil {
		return 0, err
	}
	return createdID(envelope.payload()), nil
}

// UpdateJob saves an existing task. The admin revalidates every field, so the
// form must send the full POJO, not a patch.
func (p *stackProtocol) UpdateJob(ctx context.Context, job JobMutation) error {
	if job.ID <= 0 {
		return newValidationError("id", "id must be positive")
	}
	if err := job.validate(); err != nil {
		return err
	}
	values := url.Values{}
	values.Set("id", itoa(job.ID))
	p.applyJobMutation(values, job)

	_, err := p.client.callAPI(ctx, http.MethodPost, p.jobMutateRoute(false), values, nil)
	return err
}

// DeleteJobs removes tasks. The 3.x admin accepts exactly one id per call, so
// the batch walks one call at a time there too; 2.x takes a bare id anyway.
func (p *stackProtocol) DeleteJobs(ctx context.Context, ids []int) error {
	if len(ids) == 0 {
		return newValidationError("ids", "at least one task id is required")
	}
	route := p.deleteRoute(true)
	for _, id := range ids {
		if id <= 0 {
			return newValidationError("ids", "ids must be positive")
		}
		values := url.Values{}
		p.applyID(values, id)
		if _, err := p.client.callAPI(ctx, http.MethodPost, route, values, nil); err != nil {
			return err
		}
	}
	return nil
}

// CreateJobGroup adds one executor and returns the created id when reported.
func (p *stackProtocol) CreateJobGroup(ctx context.Context, group GroupMutation) (int, error) {
	if err := group.validate(); err != nil {
		return 0, err
	}
	values := url.Values{}
	p.applyGroupMutation(values, group)

	envelope, err := p.client.callAPI(ctx, http.MethodPost, p.groupMutateRoute(true), values, nil)
	if err != nil {
		return 0, err
	}
	return createdID(envelope.payload()), nil
}

// UpdateJobGroup saves an existing executor.
func (p *stackProtocol) UpdateJobGroup(ctx context.Context, group GroupMutation) error {
	if group.ID <= 0 {
		return newValidationError("id", "id must be positive")
	}
	if err := group.validate(); err != nil {
		return err
	}
	values := url.Values{}
	values.Set("id", itoa(group.ID))
	p.applyGroupMutation(values, group)

	_, err := p.client.callAPI(ctx, http.MethodPost, p.groupMutateRoute(false), values, nil)
	return err
}

// DeleteJobGroups removes executors one call per id, mirroring DeleteJobs.
func (p *stackProtocol) DeleteJobGroups(ctx context.Context, ids []int) error {
	if len(ids) == 0 {
		return newValidationError("ids", "at least one executor id is required")
	}
	route := p.deleteRoute(false)
	for _, id := range ids {
		if id <= 0 {
			return newValidationError("ids", "ids must be positive")
		}
		values := url.Values{}
		p.applyID(values, id)
		if _, err := p.client.callAPI(ctx, http.MethodPost, route, values, nil); err != nil {
			return err
		}
	}
	return nil
}

// SaveGlueSource writes a GLUE job's source through the admin's dedicated code
// editor route (/jobcode/save). Every supported version binds that route with
// the same id/glueSource/glueRemark parameters — 2.3.1 already ships it — so
// the older "read the task, then update it" detour is not needed: it had to
// page through the whole task list just to find one row.
func (p *stackProtocol) SaveGlueSource(ctx context.Context, jobID int, glueSource, glueRemark string) error {
	if jobID <= 0 {
		return newValidationError("jobID", "jobID must be positive")
	}
	if strings.TrimSpace(glueSource) == "" {
		return newValidationError("glueSource", "glueSource is required")
	}
	// The admin refuses a blank remark and one outside 4-100 characters.
	remark := strings.TrimSpace(glueRemark)
	remarkLen := len([]rune(remark))
	if remarkLen < 4 || remarkLen > 100 {
		return newValidationError("glueRemark", "glueRemark must be 4-100 characters")
	}
	values := url.Values{}
	values.Set("id", itoa(jobID))
	values.Set("glueSource", glueSource)
	values.Set("glueRemark", remark)
	_, err := p.client.callAPI(ctx, http.MethodPost, route3JobCodeSave, values, nil)
	return err
}

// createdID pulls the numeric id out of a create response when the admin
// reports one; every version answers with a plain message string otherwise.
func createdID(payload []byte) int {
	if !isPresentPayload(payload) {
		return 0
	}
	var text string
	if err := json.Unmarshal(payload, &text); err != nil {
		return 0
	}
	id, err := strconv.Atoi(strings.TrimSpace(text))
	if err != nil {
		return 0
	}
	return id
}

// ScheduleTypeNone is the "no schedule" value the admin accepts on save.
const ScheduleTypeNone = "NONE"

// stackProtocol 满足变更接口的编译期断言。
var _ jobMutator = (*stackProtocol)(nil)
