package xxljob

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Routes shared by every supported version. XXL-JOB does not restrict the HTTP
// method for these endpoints; the admin's own pages use POST, so we do too.
const (
	routeJobGroupPageList   = "/jobgroup/pageList"
	routeJobGroupLoadByID   = "/jobgroup/loadById"
	routeJobInfoPageList    = "/jobinfo/pageList"
	routeJobInfoTrigger     = "/jobinfo/trigger"
	routeJobInfoStart       = "/jobinfo/start"
	routeJobInfoStop        = "/jobinfo/stop"
	routeJobInfoNextTrigger = "/jobinfo/nextTriggerTime"
	routeJobLogPageList     = "/joblog/pageList"
	routeJobLogDetailCat    = "/joblog/logDetailCat"
	routeJobLogKill         = "/joblog/logKill"
)

// ListJobGroups returns one page of executors.
func (p *stackProtocol) ListJobGroups(ctx context.Context, req GroupListRequest) (PageResult[JobGroup], error) {
	values := url.Values{}
	page, size := normalizePage(req.Page), normalizePageSize(req.Size)
	p.applyPaging(values, page, size)
	p.applyGroupFilter(values, req.AppName, req.Title)

	envelope, err := p.client.callAPI(ctx, http.MethodPost, routeJobGroupPageList, values, nil)
	if err != nil {
		return PageResult[JobGroup]{}, err
	}
	result, err := decodePage[JobGroup](envelope.pagePayload())
	if err != nil {
		return PageResult[JobGroup]{}, err
	}
	return finalizePage(result, page, size)
}

// LoadJobGroup returns a single executor including its registry nodes.
func (p *stackProtocol) LoadJobGroup(ctx context.Context, id int) (JobGroup, error) {
	if id <= 0 {
		return JobGroup{}, newValidationError("id", "id must be positive")
	}
	values := url.Values{}
	// loadById binds a single "id" on every version. Only the jobinfo batch
	// routes (start/stop) take ids[] on 3.3+, so the stack-aware helper must
	// not be used here: sending ids[] makes the admin answer with a 400 error
	// page instead of the executor.
	values.Set("id", itoa(id))

	envelope, err := p.client.callAPI(ctx, http.MethodPost, routeJobGroupLoadByID, values, nil)
	if err != nil {
		return JobGroup{}, err
	}
	var group JobGroup
	if !isPresentPayload(envelope.payload()) {
		return group, remoteError(http.StatusNotFound, "executor not found")
	}
	if err := json.Unmarshal(envelope.payload(), &group); err != nil {
		return JobGroup{}, localizedXxlJobErrorWithCause("xxljob.backend.error.invalid_response", nil, err)
	}
	return group, nil
}

// ListJobs returns one page of task definitions.
func (p *stackProtocol) ListJobs(ctx context.Context, req JobListRequest) (PageResult[JobInfo], error) {
	values := url.Values{}
	page, size := normalizePage(req.Page), normalizePageSize(req.Size)
	p.applyPaging(values, page, size)
	p.applyJobFilter(values, req)

	envelope, err := p.client.callAPI(ctx, http.MethodPost, routeJobInfoPageList, values, nil)
	if err != nil {
		return PageResult[JobInfo]{}, err
	}
	result, err := decodePage[JobInfo](envelope.pagePayload())
	if err != nil {
		return PageResult[JobInfo]{}, err
	}
	return finalizePage(result, page, size)
}

// TriggerJob runs a task once. The admin returns a short message describing
// which executor accepted the dispatch.
func (p *stackProtocol) TriggerJob(ctx context.Context, jobID int, executorParam string) (string, error) {
	if jobID <= 0 {
		return "", newValidationError("jobID", "jobID must be positive")
	}
	values := url.Values{}
	// A blank addressList asks the admin to route through auto registration.
	values.Set("id", itoa(jobID))
	values.Set("executorParam", executorParam)
	values.Set("addressList", "")

	envelope, err := p.client.callAPI(ctx, http.MethodPost, routeJobInfoTrigger, values, nil)
	if err != nil {
		return "", err
	}
	return adminText(envelope.payload()), nil
}

func (p *stackProtocol) changeTriggerStatus(ctx context.Context, jobIDs []int, action string) error {
	if len(jobIDs) == 0 {
		return newValidationError("jobIDs", "at least one task id is required")
	}
	// 3.3+ 用 ids[] 一次带全；2.x 的 id 参数互相覆盖，逐个发送才不会静默丢 id。
	if p.stack.usesBatchIDs() {
		values := url.Values{}
		for _, id := range jobIDs {
			values.Add("ids[]", strconv.Itoa(id))
		}
		_, err := p.client.callAPI(ctx, http.MethodPost, action, values, nil)
		return err
	}
	for _, id := range jobIDs {
		values := url.Values{}
		values.Set("id", strconv.Itoa(id))
		if _, err := p.client.callAPI(ctx, http.MethodPost, action, values, nil); err != nil {
			return err
		}
	}
	return nil
}

// StartJobs resumes scheduling for the given tasks.
func (p *stackProtocol) StartJobs(ctx context.Context, ids []int) error {
	return p.changeTriggerStatus(ctx, ids, routeJobInfoStart)
}

// StopJobs pauses scheduling for the given tasks.
func (p *stackProtocol) StopJobs(ctx context.Context, ids []int) error {
	return p.changeTriggerStatus(ctx, ids, routeJobInfoStop)
}

// NextTriggerTimes previews the upcoming fire times for a schedule expression.
func (p *stackProtocol) NextTriggerTimes(
	ctx context.Context,
	scheduleType string,
	scheduleConf string,
) ([]string, error) {
	if scheduleType == "" || scheduleConf == "" {
		return nil, newValidationError("scheduleConf", "scheduleType and scheduleConf are required")
	}
	values := url.Values{}
	values.Set("scheduleType", scheduleType)
	values.Set("scheduleConf", scheduleConf)

	envelope, err := p.client.callAPI(ctx, http.MethodPost, routeJobInfoNextTrigger, values, nil)
	if err != nil {
		return nil, err
	}
	var times []string
	if !isPresentPayload(envelope.payload()) {
		return []string{}, nil
	}
	if err := json.Unmarshal(envelope.payload(), &times); err != nil {
		return nil, localizedXxlJobErrorWithCause("xxljob.backend.error.invalid_response", nil, err)
	}
	return times, nil
}

// ListLogs returns one page of execution records.
func (p *stackProtocol) ListLogs(ctx context.Context, req LogListRequest) (PageResult[JobLog], error) {
	values := url.Values{}
	page, size := normalizePage(req.Page), normalizePageSize(req.Size)
	p.applyPaging(values, page, size)
	values.Set("jobGroup", itoa(req.JobGroup))
	values.Set("jobId", itoa(req.JobID))
	values.Set("logStatus", itoa(req.LogStatus))
	values.Set("filterTime", normalizeFilterTime(req.FilterTime))

	envelope, err := p.client.callAPI(ctx, http.MethodPost, routeJobLogPageList, values, nil)
	if err != nil {
		return PageResult[JobLog]{}, err
	}
	result, err := decodePage[JobLog](envelope.pagePayload())
	if err != nil {
		return PageResult[JobLog]{}, err
	}
	return finalizePage(result, page, size)
}

// LogDetail reads one incremental slice of an executor's rolling log. The admin
// proxies the call, so a failure here means the executor is unreachable rather
// than the admin.
func (p *stackProtocol) LogDetail(ctx context.Context, logID, fromLineNum int) (LogDetail, error) {
	if logID <= 0 {
		return LogDetail{}, newValidationError("logID", "logID must be positive")
	}
	values := url.Values{}
	values.Set("logId", itoa(logID))
	values.Set("fromLineNum", itoa(fromLineNum))

	envelope, err := p.client.callAPI(ctx, http.MethodPost, routeJobLogDetailCat, values, nil)
	if err != nil {
		return LogDetail{}, asExecutorForwardError(err)
	}
	var detail LogDetail
	if !isPresentPayload(envelope.payload()) {
		return detail, &ExecutorForwardError{Detail: "empty log detail payload"}
	}
	if err := json.Unmarshal(envelope.payload(), &detail); err != nil {
		return LogDetail{}, localizedXxlJobErrorWithCause("xxljob.backend.error.invalid_response", nil, err)
	}
	return detail, nil
}

// LogKill terminates a still-running execution through the admin's proxy to the
// executor, so any business failure means the forward did not succeed.
func (p *stackProtocol) LogKill(ctx context.Context, logID int) error {
	if logID <= 0 {
		return newValidationError("logID", "logID must be positive")
	}
	values := url.Values{}
	values.Set("id", itoa(logID))

	_, err := p.client.callAPI(ctx, http.MethodPost, routeJobLogKill, values, nil)
	return asExecutorForwardError(err)
}

// asExecutorForwardError re-labels admin-side failures on the two proxied
// endpoints. Reaching this point means the admin itself answered, so a business
// error can only come from the executor hop.
func asExecutorForwardError(err error) error {
	if err == nil {
		return nil
	}
	var remote *RemoteError
	if errors.As(err, &remote) {
		return &ExecutorForwardError{Detail: remote.Msg}
	}
	return err
}

func finalizePage[T any](result PageResult[T], page, size int) (PageResult[T], error) {
	if result.Rows == nil {
		result.Rows = []T{}
	}
	result.Page = page
	result.Size = size
	return result, nil
}

// adminText renders a payload the admin returns as a bare message string.
func adminText(payload []byte) string {
	if !isPresentPayload(payload) {
		return ""
	}
	var text string
	if err := json.Unmarshal(payload, &text); err == nil {
		return text
	}
	return truncateDiagnostic(string(payload))
}

// normalizeFilterTime keeps the admin's "left - right" shape intact and refuses
// values that do not look like a range, so a malformed range fails locally
// instead of silently matching everything.
func normalizeFilterTime(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if !strings.Contains(trimmed, " - ") {
		return ""
	}
	return trimmed
}

func itoa(value int) string { return strconv.Itoa(value) }
