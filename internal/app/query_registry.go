package app

import (
	"context"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"github.com/google/uuid"
)

func generateQueryID() string {
	return "query-" + uuid.New().String()
}

func (a *App) registerRunningQuery(queryID string, cancel context.CancelFunc, retainUntilDone bool, driverTypes ...string) func() {
	cleanup, _ := a.registerRunningQueryWithCancellationCapability(queryID, cancel, retainUntilDone, driverTypes...)
	return cleanup
}

func (a *App) registerRunningQueryWithCancellationCapability(queryID string, cancel context.CancelFunc, retainUntilDone bool, driverTypes ...string) (func(), func(bool)) {
	driverType := ""
	if len(driverTypes) > 0 {
		driverType = normalizeDriverType(driverTypes[0])
	}
	a.queryMu.Lock()
	if a.runningQueries == nil {
		a.runningQueries = make(map[string]queryContext)
	}
	a.nextQueryRegistrationID++
	if a.nextQueryRegistrationID == 0 {
		a.nextQueryRegistrationID++
	}
	registrationID := a.nextQueryRegistrationID
	a.runningQueries[queryID] = queryContext{
		cancel:          cancel,
		started:         time.Now(),
		retainUntilDone: retainUntilDone,
		registrationID:  registrationID,
		driverType:      driverType,
	}
	a.queryMu.Unlock()

	cleanup := func() {
		a.queryMu.Lock()
		if current, exists := a.runningQueries[queryID]; exists && current.registrationID == registrationID {
			delete(a.runningQueries, queryID)
		}
		a.queryMu.Unlock()
	}
	setCancellable := func(cancellable bool) {
		a.queryMu.Lock()
		if current, exists := a.runningQueries[queryID]; exists && current.registrationID == registrationID {
			current.cancellationUnsupported = !cancellable
			a.runningQueries[queryID] = current
		}
		a.queryMu.Unlock()
	}
	return cleanup, setCancellable
}

// registerExclusiveRunningQuery registers a long-running task only when the
// caller-provided ID is not already owned by another task. Import jobs use this
// stricter contract because replacing an owner would make cancellation target
// the wrong operation and let an older cleanup remove the newer task.
func (a *App) registerExclusiveRunningQuery(queryID string, cancel context.CancelFunc, retainUntilDone bool) (func(), bool) {
	a.queryMu.Lock()
	if a.runningQueries == nil {
		a.runningQueries = make(map[string]queryContext)
	}
	if _, exists := a.runningQueries[queryID]; exists {
		a.queryMu.Unlock()
		return func() {}, false
	}
	a.nextQueryRegistrationID++
	if a.nextQueryRegistrationID == 0 {
		a.nextQueryRegistrationID++
	}
	registrationID := a.nextQueryRegistrationID
	a.runningQueries[queryID] = queryContext{
		cancel:          cancel,
		started:         time.Now(),
		retainUntilDone: retainUntilDone,
		registrationID:  registrationID,
	}
	a.queryMu.Unlock()

	return func() {
		a.queryMu.Lock()
		if current, exists := a.runningQueries[queryID]; exists && current.registrationID == registrationID {
			delete(a.runningQueries, queryID)
		}
		a.queryMu.Unlock()
	}, true
}

// CancelQuery cancels a running query by its ID
func (a *App) CancelQuery(queryID string) connection.QueryResult {
	a.queryMu.Lock()
	current, exists := a.runningQueries[queryID]
	if !exists {
		a.queryMu.Unlock()
		a.requestDiagnostics().MarkCancellation(queryID, false)
		logger.Warnf("取消查询失败：queryID=%s 不存在或已完成", queryID)
		return connection.QueryResult{Success: false, Message: a.appText("query_editor.message.cancel_no_running", nil)}
	}
	if current.cancellationUnsupported {
		a.queryMu.Unlock()
		logger.Warnf("取消查询失败：queryID=%s 的底层驱动不支持取消", queryID)
		return connection.QueryResult{
			Success:           false,
			Message:           a.appText("query_editor.message.cancel_unsupported", nil),
			CancellationState: connection.QueryCancellationStateUnsupported,
		}
	}
	current.cancel()
	a.requestDiagnostics().MarkCancellation(queryID, true)
	if !current.retainUntilDone {
		delete(a.runningQueries, queryID)
	}
	a.queryMu.Unlock()
	a.emitQueryExecutionCancelling(queryID)
	logger.Infof("查询已取消：queryID=%s", queryID)
	return connection.QueryResult{Success: true, Message: a.appText("query_editor.message.cancel_success", nil)}
}

// cleanupStaleQueries removes queries older than maxAge.
func (a *App) cleanupStaleQueries(maxAge time.Duration) {
	a.queryMu.Lock()
	defer a.queryMu.Unlock()

	now := time.Now()
	for id, ctx := range a.runningQueries {
		if now.Sub(ctx.started) > maxAge {
			delete(a.runningQueries, id)
		}
	}
}

// GenerateQueryID generates a unique query ID for cancellation tracking
func (a *App) GenerateQueryID() string {
	return generateQueryID()
}
