package app

import (
	"context"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/xxljob"
)

// xxlJobMutationBlocked reports whether a mutating admin action must be refused.
// A read-only connection, or one with script execution restricted, must not be
// able to start, stop, trigger, or kill anything.
func xxlJobMutationBlocked(config connection.ConnectionConfig) bool {
	if isConnectionForcedReadOnly(config) {
		return true
	}
	return isConnectionScriptExecutionRestricted(config)
}

func (a *App) xxlJobMutationBlockedMessage(config connection.ConnectionConfig) string {
	return a.appText("xxljob.backend.error.read_only", nil)
}

// withXxlJobMutationContext adds the read-only guard on top of the connection
// resolution used by every changing admin action.
func (a *App) withXxlJobMutationContext(
	config connection.ConnectionConfig,
	action string,
	run func(ctx context.Context, protocol xxljob.Protocol) connection.QueryResult,
) connection.QueryResult {
	if xxlJobMutationBlocked(config) {
		logger.Warnf("XXL-JOB %s 被只读保护拦截：%s", action, formatXxlJobConnSummary(config))
		return connection.QueryResult{Success: false, Message: a.xxlJobMutationBlockedMessage(config)}
	}
	return a.withXxlJobContext(config, action, run)
}

// XxlJobListJobs lists task definitions for the task panel.
func (a *App) XxlJobListJobs(
	config connection.ConnectionConfig,
	query XxlJobListQuery,
) connection.QueryResult {
	return a.withXxlJobContext(config, "XxlJobListJobs", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		page, err := protocol.ListJobs(ctx, xxljob.JobListRequest{
			Page:            query.Page,
			Size:            query.Size,
			JobGroup:        query.JobGroup,
			TriggerStatus:   query.TriggerStatus,
			Name:            query.Name,
			ExecutorHandler: query.ExecutorHandler,
			Author:          query.Author,
		})
		if err != nil {
			logger.Error(err, "XxlJobListJobs 失败：%s", formatXxlJobConnSummary(config))
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{Success: true, Data: page}
	})
}

// XxlJobTriggerJob runs a task once. executorParam is optional and is forwarded
// verbatim so a shell handler can accept arguments per run.
func (a *App) XxlJobTriggerJob(
	config connection.ConnectionConfig,
	jobID int,
	executorParam string,
) connection.QueryResult {
	return a.withXxlJobMutationContext(config, "XxlJobTriggerJob", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		message, err := protocol.TriggerJob(ctx, jobID, strings.TrimSpace(executorParam))
		if err != nil {
			logger.Error(err, "XxlJobTriggerJob 失败：id=%d", jobID)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{
			Success: true,
			Message: a.appText("xxljob.backend.message.trigger_success", nil),
			Data:    map[string]any{"detail": message},
		}
	})
}

// XxlJobStartJobs resumes scheduling for the given tasks.
func (a *App) XxlJobStartJobs(config connection.ConnectionConfig, jobIDs []int) connection.QueryResult {
	return a.withXxlJobMutationContext(config, "XxlJobStartJobs", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		if err := protocol.StartJobs(ctx, normalizeXxlJobIDs(jobIDs)); err != nil {
			logger.Error(err, "XxlJobStartJobs 失败：ids=%v", jobIDs)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{
			Success: true,
			Message: a.appText("xxljob.backend.message.start_success", nil),
		}
	})
}

// XxlJobStopJobs pauses scheduling for the given tasks.
func (a *App) XxlJobStopJobs(config connection.ConnectionConfig, jobIDs []int) connection.QueryResult {
	return a.withXxlJobMutationContext(config, "XxlJobStopJobs", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		if err := protocol.StopJobs(ctx, normalizeXxlJobIDs(jobIDs)); err != nil {
			logger.Error(err, "XxlJobStopJobs 失败：ids=%v", jobIDs)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{
			Success: true,
			Message: a.appText("xxljob.backend.message.stop_success", nil),
		}
	})
}

// XxlJobNextTriggerTimes previews the next fire times for a schedule
// expression, which the task panel shows inline.
func (a *App) XxlJobNextTriggerTimes(
	config connection.ConnectionConfig,
	scheduleType string,
	scheduleConf string,
) connection.QueryResult {
	return a.withXxlJobContext(config, "XxlJobNextTriggerTimes", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		times, err := protocol.NextTriggerTimes(ctx, strings.TrimSpace(scheduleType), strings.TrimSpace(scheduleConf))
		if err != nil {
			logger.Error(err, "XxlJobNextTriggerTimes 失败：type=%s", scheduleType)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{Success: true, Data: times}
	})
}

func normalizeXxlJobIDs(jobIDs []int) []int {
	out := make([]int, 0, len(jobIDs))
	for _, id := range jobIDs {
		if id > 0 {
			out = append(out, id)
		}
	}
	return out
}
