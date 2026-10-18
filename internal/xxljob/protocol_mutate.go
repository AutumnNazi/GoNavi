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
	if strings.TrimSpace(m.ExecutorHandler) == "" {
		return newValidationError("executorHandler", "executorHandler is required")
	}
	if m.ExecutorTimeout < 0 {
		return newValidationError("executorTimeout", "executorTimeout must not be negative")
	}
	if m.ExecutorFailRetryCount < 0 {
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

// jobMutateRoute picks add vs update vs save for the stack. 3.3+ renamed add to
// insert but kept update; 2.x uses add/save.
func (p *stackProtocol) jobMutateRoute(create bool) string {
	if create {
		if p.stack.Login == LoginSSO {
			return route3JobInfoInsert
		}
		return route2JobInfoAdd
	}
	if p.stack.Login == LoginSSO {
		return route3JobInfoUpdate
	}
	return route2JobInfoSave
}

// groupMutateRoute mirrors the task naming: 3.3+ insert/update, 2.x save/update.
func (p *stackProtocol) groupMutateRoute(create bool) string {
	if create {
		if p.stack.Login == LoginSSO {
			return route3JobGroupInsert
		}
		return route2JobGroupSave
	}
	if p.stack.Login == LoginSSO {
		return route3JobGroupUpdate
	}
	return route2JobGroupUpdate
}

// deleteRoute picks the task or executor delete path for the stack.
func (p *stackProtocol) deleteRoute(job bool) string {
	if job {
		if p.stack.Login == LoginSSO {
			return route3JobInfoDelete
		}
		return route2JobInfoRemove
	}
	if p.stack.Login == LoginSSO {
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
// editor route (3.x /jobcode/save). 2.x has no separate route; the source rides
// on the jobinfo update POJO, so we fall back to loading the job and updating it.
func (p *stackProtocol) SaveGlueSource(ctx context.Context, jobID int, glueSource, glueRemark string) error {
	if jobID <= 0 {
		return newValidationError("jobID", "jobID must be positive")
	}
	if strings.TrimSpace(glueSource) == "" {
		return newValidationError("glueSource", "glueSource is required")
	}
	if p.stack.Login != LoginSSO {
		job, err := p.loadJobByID(ctx, jobID)
		if err != nil {
			return err
		}
		job.GlueSource = glueSource
		if strings.TrimSpace(glueRemark) != "" {
			job.GlueRemark = glueRemark
		}
		return p.UpdateJob(ctx, jobMutationFromJobInfo(job))
	}
	values := url.Values{}
	values.Set("id", itoa(jobID))
	values.Set("glueSource", glueSource)
	values.Set("glueRemark", glueRemark)
	_, err := p.client.callAPI(ctx, http.MethodPost, route3JobCodeSave, values, nil)
	return err
}

// loadJobByID reads one task definition through the paging endpoint filtered by
// nothing — the admin has no single-task GET for 2.x, so we page for it.
func (p *stackProtocol) loadJobByID(ctx context.Context, jobID int) (JobInfo, error) {
	values := url.Values{}
	page, size := normalizePage(1), normalizePageSize(maxPageSize)
	p.applyPaging(values, page, size)
	values.Set("jobGroup", "0")
	values.Set("triggerStatus", "-1")
	values.Set("executorHandler", "")
	values.Set("author", "")
	if p.stack.Fields == FieldRenamed {
		values.Set("name", "")
	} else {
		values.Set("jobDesc", "")
	}

	envelope, err := p.client.callAPI(ctx, http.MethodPost, routeJobInfoPageList, values, nil)
	if err != nil {
		return JobInfo{}, err
	}
	result, err := decodePage[JobInfo](envelope.payload())
	if err != nil {
		return JobInfo{}, err
	}
	for _, job := range result.Rows {
		if job.ID == jobID {
			return job, nil
		}
	}
	return JobInfo{}, remoteError(http.StatusNotFound, "task not found")
}

// jobMutationFromJobInfo converts a loaded task back into a mutation payload so
// a GLUE save can reuse the update path on 2.x.
func jobMutationFromJobInfo(job JobInfo) JobMutation {
	return JobMutation{
		ID:                     job.ID,
		JobGroup:               job.JobGroup,
		Name:                   job.Name,
		Author:                 job.Author,
		AlarmEmail:             job.AlarmEmail,
		ScheduleType:           job.ScheduleType,
		ScheduleConf:           job.ScheduleConf,
		MisfireStrategy:        job.MisfireStrategy,
		ExecutorRouteStrategy:  job.ExecutorRouteStrategy,
		ExecutorHandler:        job.ExecutorHandler,
		ExecutorParam:          job.ExecutorParam,
		ExecutorBlockStrategy:  job.ExecutorBlockStrategy,
		ExecutorTimeout:        job.ExecutorTimeout,
		ExecutorFailRetryCount: job.ExecutorFailRetryCount,
		GlueType:               job.GlueType,
		GlueSource:             job.GlueSource,
		GlueRemark:             job.GlueRemark,
		ChildJobID:             job.ChildJobID,
		TriggerStatus:          job.TriggerStatus,
	}
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
