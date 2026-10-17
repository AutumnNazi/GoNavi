package app

import (
	"context"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/xxljob"
)

// XxlJobListQuery carries the paging and filter arguments shared by the three
// panels. Every field is optional so the frontend can pass through only the
// filters a given panel actually exposes.
type XxlJobListQuery struct {
	Page            int    `json:"page"`
	Size            int    `json:"size"`
	JobGroup        int    `json:"jobGroup"`
	TriggerStatus   int    `json:"triggerStatus"`
	LogStatus       int    `json:"logStatus"`
	JobID           int    `json:"jobId"`
	AppName         string `json:"appName"`
	Title           string `json:"title"`
	Name            string `json:"name"`
	ExecutorHandler string `json:"executorHandler"`
	Author          string `json:"author"`
	FilterTime      string `json:"filterTime"`
}

// withXxlJobContext resolves the connection and the detected protocol stack,
// then runs one admin call with a context that lives exactly as long as the
// call does.
func (a *App) withXxlJobContext(
	config connection.ConnectionConfig,
	action string,
	run func(ctx context.Context, protocol xxljob.Protocol) connection.QueryResult,
) connection.QueryResult {
	config.Type = "xxljob"
	ctx, cancel := a.xxlJobOperationContext(config)
	defer cancel()

	client, err := a.getXxlJobClientWithContext(ctx, config)
	if err != nil {
		logger.Error(err, "XXL-JOB %s 获取连接失败：%s", action, formatXxlJobConnSummary(config))
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return run(ctx, client.NewProtocol())
}

// XxlJobListJobGroups lists executors for the executor panel.
func (a *App) XxlJobListJobGroups(
	config connection.ConnectionConfig,
	query XxlJobListQuery,
) connection.QueryResult {
	return a.withXxlJobContext(config, "XxlJobListJobGroups", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		page, err := protocol.ListJobGroups(ctx, xxljob.GroupListRequest{
			Page:    query.Page,
			Size:    query.Size,
			AppName: query.AppName,
			Title:   query.Title,
		})
		if err != nil {
			logger.Error(err, "XxlJobListJobGroups 失败：%s", formatXxlJobConnSummary(config))
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{Success: true, Data: page}
	})
}

// XxlJobLoadJobGroup returns one executor including its registered nodes.
func (a *App) XxlJobLoadJobGroup(config connection.ConnectionConfig, groupID int) connection.QueryResult {
	return a.withXxlJobContext(config, "XxlJobLoadJobGroup", func(
		ctx context.Context,
		protocol xxljob.Protocol,
	) connection.QueryResult {
		group, err := protocol.LoadJobGroup(ctx, groupID)
		if err != nil {
			logger.Error(err, "XxlJobLoadJobGroup 失败：id=%d", groupID)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{Success: true, Data: group}
	})
}
