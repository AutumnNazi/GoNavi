package app

import (
	"context"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/xxljob"
)

// XxlJobJobMutation is the task form payload. A zero ID creates a task; a
// positive ID updates it. Field names mirror the admin's own POJO so the
// frontend form maps one to one.
type XxlJobJobMutation struct {
	ID                     int    `json:"id"`
	JobGroup               int    `json:"jobGroup"`
	Name                   string `json:"name"`
	Author                 string `json:"author"`
	AlarmEmail             string `json:"alarmEmail"`
	ScheduleType           string `json:"scheduleType"`
	ScheduleConf           string `json:"scheduleConf"`
	MisfireStrategy        string `json:"misfireStrategy"`
	ExecutorRouteStrategy  string `json:"executorRouteStrategy"`
	ExecutorHandler        string `json:"executorHandler"`
	ExecutorParam          string `json:"executorParam"`
	ExecutorBlockStrategy  string `json:"executorBlockStrategy"`
	ExecutorTimeout        int    `json:"executorTimeout"`
	ExecutorFailRetryCount int    `json:"executorFailRetryCount"`
	GlueType               string `json:"glueType"`
	GlueSource             string `json:"glueSource"`
	GlueRemark             string `json:"glueRemark"`
	ChildJobID             string `json:"childJobId"`
	TriggerStatus          int    `json:"triggerStatus"`
}

// XxlJobGroupMutation is the executor form payload. A zero ID creates an
// executor; a positive ID updates it.
type XxlJobGroupMutation struct {
	ID          int    `json:"id"`
	AppName     string `json:"appName"`
	Title       string `json:"title"`
	AddressType int    `json:"addressType"`
	AddressList string `json:"addressList"`
}

// XxlJobSaveJob adds or updates one task. The stack picks the route family
// (2.x add/save, 3.3+ insert/update) and the description column name.
func (a *App) XxlJobSaveJob(
	config connection.ConnectionConfig,
	job XxlJobJobMutation,
) connection.QueryResult {
	return a.withXxlJobMutationContext(config, "XxlJobSaveJob", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		mutation := xxljob.JobMutation{
			ID:                     job.ID,
			JobGroup:               job.JobGroup,
			Name:                   strings.TrimSpace(job.Name),
			Author:                 strings.TrimSpace(job.Author),
			AlarmEmail:             strings.TrimSpace(job.AlarmEmail),
			ScheduleType:           strings.TrimSpace(job.ScheduleType),
			ScheduleConf:           strings.TrimSpace(job.ScheduleConf),
			MisfireStrategy:        strings.TrimSpace(job.MisfireStrategy),
			ExecutorRouteStrategy:  strings.TrimSpace(job.ExecutorRouteStrategy),
			ExecutorHandler:        strings.TrimSpace(job.ExecutorHandler),
			ExecutorParam:          job.ExecutorParam,
			ExecutorBlockStrategy:  strings.TrimSpace(job.ExecutorBlockStrategy),
			ExecutorTimeout:        job.ExecutorTimeout,
			ExecutorFailRetryCount: job.ExecutorFailRetryCount,
			GlueType:               strings.TrimSpace(job.GlueType),
			GlueSource:             job.GlueSource,
			GlueRemark:             strings.TrimSpace(job.GlueRemark),
			ChildJobID:             strings.TrimSpace(job.ChildJobID),
			TriggerStatus:          job.TriggerStatus,
		}
		created := mutation.ID <= 0
		if created {
			id, err := protocol.CreateJob(ctx, mutation)
			if err != nil {
				logger.Error(err, "XxlJobSaveJob 新增失败：%s", formatXxlJobConnSummary(config))
				return connection.QueryResult{Success: false, Message: err.Error()}
			}
			return connection.QueryResult{
				Success: true,
				Message: a.appText("xxljob.backend.message.save_success", nil),
				Data:    map[string]any{"id": id},
			}
		}
		if err := protocol.UpdateJob(ctx, mutation); err != nil {
			logger.Error(err, "XxlJobSaveJob 更新失败：id=%d", mutation.ID)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{
			Success: true,
			Message: a.appText("xxljob.backend.message.save_success", nil),
		}
	})
}

// XxlJobDeleteJobs removes tasks. The 3.x admin accepts one id per call, so the
// domain layer walks the batch.
func (a *App) XxlJobDeleteJobs(config connection.ConnectionConfig, jobIDs []int) connection.QueryResult {
	return a.withXxlJobMutationContext(config, "XxlJobDeleteJobs", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		if err := protocol.DeleteJobs(ctx, normalizeXxlJobIDs(jobIDs)); err != nil {
			logger.Error(err, "XxlJobDeleteJobs 失败：ids=%v", jobIDs)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{
			Success: true,
			Message: a.appText("xxljob.backend.message.delete_success", nil),
		}
	})
}

// XxlJobSaveJobGroup adds or updates one executor.
func (a *App) XxlJobSaveJobGroup(
	config connection.ConnectionConfig,
	group XxlJobGroupMutation,
) connection.QueryResult {
	return a.withXxlJobMutationContext(config, "XxlJobSaveJobGroup", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		mutation := xxljob.GroupMutation{
			ID:          group.ID,
			AppName:     strings.TrimSpace(group.AppName),
			Title:       strings.TrimSpace(group.Title),
			AddressType: group.AddressType,
			AddressList: strings.TrimSpace(group.AddressList),
		}
		if mutation.ID <= 0 {
			id, err := protocol.CreateJobGroup(ctx, mutation)
			if err != nil {
				logger.Error(err, "XxlJobSaveJobGroup 新增失败：%s", formatXxlJobConnSummary(config))
				return connection.QueryResult{Success: false, Message: err.Error()}
			}
			return connection.QueryResult{
				Success: true,
				Message: a.appText("xxljob.backend.message.save_success", nil),
				Data:    map[string]any{"id": id},
			}
		}
		if err := protocol.UpdateJobGroup(ctx, mutation); err != nil {
			logger.Error(err, "XxlJobSaveJobGroup 更新失败：id=%d", mutation.ID)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{
			Success: true,
			Message: a.appText("xxljob.backend.message.save_success", nil),
		}
	})
}

// XxlJobDeleteJobGroups removes executors.
func (a *App) XxlJobDeleteJobGroups(config connection.ConnectionConfig, groupIDs []int) connection.QueryResult {
	return a.withXxlJobMutationContext(config, "XxlJobDeleteJobGroups", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		if err := protocol.DeleteJobGroups(ctx, normalizeXxlJobIDs(groupIDs)); err != nil {
			logger.Error(err, "XxlJobDeleteJobGroups 失败：ids=%v", groupIDs)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{
			Success: true,
			Message: a.appText("xxljob.backend.message.delete_success", nil),
		}
	})
}

// XxlJobSaveGlueSource writes a GLUE job's source through the stack's code
// editor route. 2.x falls back to a full jobinfo update carrying the source.
func (a *App) XxlJobSaveGlueSource(
	config connection.ConnectionConfig,
	jobID int,
	glueSource string,
	glueRemark string,
) connection.QueryResult {
	return a.withXxlJobMutationContext(config, "XxlJobSaveGlueSource", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		if err := protocol.SaveGlueSource(ctx, jobID, glueSource, strings.TrimSpace(glueRemark)); err != nil {
			logger.Error(err, "XxlJobSaveGlueSource 失败：id=%d", jobID)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{
			Success: true,
			Message: a.appText("xxljob.backend.message.save_success", nil),
		}
	})
}
