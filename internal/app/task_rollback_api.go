package app

import (
	"context"
	"errors"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/importjob"
	"GoNavi-Wails/internal/syncjob"
	"GoNavi-Wails/internal/taskrollback"
)

func (a *App) RollbackImportJob(jobID string) connection.QueryResult {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" || a == nil {
		return a.rollbackQueryResult(taskrollback.ErrNotFound)
	}
	if a.importTaskIsRunning(jobID) {
		return connection.QueryResult{Success: false, Message: a.appText("task_rollback.error.busy", nil)}
	}
	store, err := a.ensureImportJobStore()
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	job, err := store.Get(jobID)
	if err != nil {
		if errors.Is(err, importjob.ErrNotFound) {
			return a.rollbackQueryResult(taskrollback.ErrNotFound)
		}
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if !isImportJobTerminalStatus(job.Status) {
		return connection.QueryResult{Success: false, Message: a.appText("task_rollback.error.busy", nil)}
	}
	return a.rollbackReadyTask(context.Background(), jobID)
}

func (a *App) RollbackDataSyncRun(runID string) connection.QueryResult {
	if a == nil {
		return a.rollbackQueryResult(taskrollback.ErrNotFound)
	}
	ctx := context.Background()
	manager, err := a.ensureDataSyncJobManager()
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	run, err := manager.GetRun(ctx, strings.TrimSpace(runID))
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if !dataSyncRunTerminal(run.Status) {
		return connection.QueryResult{Success: false, Message: a.appText("task_rollback.error.busy", nil)}
	}
	runs, err := manager.ListRuns(ctx, run.JobID, 500)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	for _, item := range runs {
		if !dataSyncRunTerminal(item.Status) {
			return connection.QueryResult{Success: false, Message: a.appText("task_rollback.error.busy", nil)}
		}
	}
	return a.rollbackReadyTask(ctx, a.syncRollbackTaskChain(ctx, run)...)
}

func (a *App) rollbackReadyTask(ctx context.Context, taskIDs ...string) connection.QueryResult {
	point, err := a.findReadyRollbackPoint(taskIDs...)
	if err != nil {
		return a.rollbackQueryResult(err)
	}
	if err := a.restoreTaskRollbackPoint(ctx, point); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Message: a.appText("task_rollback.message.restored", nil)}
}

func (a *App) rollbackQueryResult(err error) connection.QueryResult {
	if a == nil {
		return connection.QueryResult{Success: false, Message: "application is unavailable"}
	}
	mapped := a.taskRollbackRestoreError(err)
	if mapped == nil {
		return connection.QueryResult{Success: false, Message: a.appText("task_rollback.error.restore_failed", map[string]any{"detail": "unknown"})}
	}
	return connection.QueryResult{Success: false, Message: mapped.Error()}
}

func (a *App) importTaskIsRunning(jobID string) bool {
	if a == nil {
		return false
	}
	jobID = strings.TrimSpace(jobID)
	a.importTaskMu.Lock()
	defer a.importTaskMu.Unlock()
	_, running := a.importTasks[jobID]
	return running
}

func (a *App) markImportJobsRollbackReady(jobs []importjob.Job) []importjob.Job {
	if a == nil || len(jobs) == 0 {
		return jobs
	}
	marked := append([]importjob.Job(nil), jobs...)
	for index := range marked {
		if !isImportJobTerminalStatus(marked[index].Status) {
			continue
		}
		if _, err := a.findReadyRollbackPoint(marked[index].ID); err == nil {
			marked[index].RollbackReady = true
		}
	}
	return marked
}

func (a *App) markDataSyncRunsRollbackReady(ctx context.Context, runs []syncjob.RunRecord) []syncjob.RunRecord {
	if a == nil || len(runs) == 0 {
		return runs
	}
	if ctx == nil {
		ctx = context.Background()
	}
	marked := append([]syncjob.RunRecord(nil), runs...)
	for index := range marked {
		if !dataSyncRunTerminal(marked[index].Status) {
			continue
		}
		taskIDs := a.syncRollbackTaskChain(ctx, marked[index])
		if _, err := a.findReadyRollbackPoint(taskIDs...); err == nil {
			marked[index].RollbackReady = true
		}
	}
	return marked
}
