package app

import (
	"context"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/xxljob"
)

// XxlJobListLogs lists execution records for the schedule log panel.
func (a *App) XxlJobListLogs(
	config connection.ConnectionConfig,
	query XxlJobListQuery,
) connection.QueryResult {
	return a.withXxlJobContext(config, "XxlJobListLogs", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		page, err := protocol.ListLogs(ctx, xxljob.LogListRequest{
			Page:       query.Page,
			Size:       query.Size,
			JobGroup:   query.JobGroup,
			JobID:      query.JobID,
			LogStatus:  query.LogStatus,
			FilterTime: query.FilterTime,
		})
		if err != nil {
			logger.Error(err, "XxlJobListLogs 失败：%s", formatXxlJobConnSummary(config))
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{Success: true, Data: page}
	})
}

// XxlJobLogDetail reads one incremental slice of an executor's rolling log.
// fromLineNum carries the panel's current position so the admin can resume
// where the previous slice ended.
func (a *App) XxlJobLogDetail(
	config connection.ConnectionConfig,
	logID int,
	fromLineNum int,
) connection.QueryResult {
	return a.withXxlJobContext(config, "XxlJobLogDetail", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		detail, err := protocol.LogDetail(ctx, logID, fromLineNum)
		if err != nil {
			logger.Error(err, "XxlJobLogDetail 失败：id=%d", logID)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{Success: true, Data: detail}
	})
}

// XxlJobLogKill terminates a running execution through the admin's proxy to the
// executor. It is a changing action, so the read-only guard applies.
func (a *App) XxlJobLogKill(config connection.ConnectionConfig, logID int) connection.QueryResult {
	return a.withXxlJobMutationContext(config, "XxlJobLogKill", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		if err := protocol.LogKill(ctx, logID); err != nil {
			logger.Error(err, "XxlJobLogKill 失败：id=%d", logID)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{
			Success: true,
			Message: a.appText("xxljob.backend.message.kill_success", nil),
		}
	})
}
