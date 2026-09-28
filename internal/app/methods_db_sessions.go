package app

import (
	"context"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/sqlaudit"
)

// DBListSessions returns the normalized server-side sessions exposed by one
// database engine. Unsupported engines return a successful empty payload so
// the frontend can show an honest capability state without opening a connection.
func (a *App) DBListSessions(
	config connection.ConnectionConfig,
	dbName string,
) connection.QueryResult {
	return a.dbListSessionsContext(a.sessionWorkbenchParentContext(), config, dbName)
}

func (a *App) dbListSessionsContext(
	parent context.Context,
	config connection.ConnectionConfig,
	dbName string,
) connection.QueryResult {
	runConfig := normalizeRunConfig(config, dbName)
	engine, capability := db.SessionCapabilityFor(runConfig)
	emptyPayload := connection.SessionListPayload{
		Engine:     engine,
		Capability: capability,
		Sessions:   []connection.DatabaseSession{},
	}
	if !capability.Supported {
		return connection.QueryResult{Success: true, Data: emptyPayload}
	}

	database, queryContext, cleanup, err := a.openSessionWorkbenchDatabase(parent, runConfig)
	if err != nil {
		logger.Error(err, "DBListSessions 获取隔离连接失败：%s", formatConnSummary(runConfig))
		return connection.QueryResult{
			Success: false,
			Message: a.appText("session_workbench.backend.error.list_failed", map[string]any{"detail": sessionWorkbenchErrorDetail(err)}),
		}
	}
	defer cleanup()

	payload, err := db.NewSessionOperator(database, runConfig).ListSessions(queryContext)
	if err != nil {
		logger.Error(err, "DBListSessions 查询服务器会话失败：%s", formatConnSummary(runConfig))
		return connection.QueryResult{
			Success: false,
			Message: a.appText("session_workbench.backend.error.list_failed", map[string]any{"detail": sessionWorkbenchErrorDetail(err)}),
		}
	}
	return connection.QueryResult{Success: true, Data: payload}
}

// DBExecuteSessionAction cancels one server query or terminates one server
// session after applying the connection's production-protection policy.
func (a *App) DBExecuteSessionAction(
	config connection.ConnectionConfig,
	dbName string,
	request connection.SessionActionRequest,
) connection.QueryResult {
	return a.dbExecuteSessionActionWithAuditContext(
		a.sessionWorkbenchParentContext(), config, dbName, request,
	)
}

func (a *App) dbExecuteSessionActionWithAuditContext(
	parent context.Context,
	config connection.ConnectionConfig,
	dbName string,
	request connection.SessionActionRequest,
) (result connection.QueryResult) {
	runConfig := normalizeRunConfig(config, dbName)
	_, capability := db.SessionCapabilityFor(runConfig)
	auditSQL := sessionWorkbenchAuditStatement(capability, request)
	defer a.beginSQLAuditUserAction(config, dbName, "session_workbench", &auditSQL, &result)()
	return a.dbExecuteSessionActionContext(parent, config, dbName, request)
}

func (a *App) dbExecuteSessionActionContext(
	parent context.Context,
	config connection.ConnectionConfig,
	dbName string,
	request connection.SessionActionRequest,
) connection.QueryResult {
	runConfig := normalizeRunConfig(config, dbName)
	_, capability := db.SessionCapabilityFor(runConfig)
	actionKey, supported := sessionWorkbenchActionKey(capability, request.Action)
	if !supported {
		return connection.QueryResult{
			Success: false,
			Message: a.appText("session_workbench.backend.error.unsupported_action", nil),
		}
	}
	protectionActionKey := "connection.backend.action.terminate_database_session"
	if request.Action == connection.SessionActionCancelQuery {
		protectionActionKey = "connection.backend.action.cancel_database_query"
	}
	if err := ensureConnectionAllowsActionWithText(
		runConfig,
		connectionProtectionScriptExecution,
		protectionActionKey,
		a.appText,
	); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}

	database, queryContext, cleanup, err := a.openSessionWorkbenchDatabase(parent, runConfig)
	if err != nil {
		return a.sessionActionFailure(actionKey, runConfig, err)
	}
	defer cleanup()

	if err := db.NewSessionOperator(database, runConfig).ExecuteSessionAction(queryContext, request); err != nil {
		return a.sessionActionFailure(actionKey, runConfig, err)
	}
	return connection.QueryResult{
		Success: true,
		Message: a.appText("session_workbench.backend.message.action_succeeded", map[string]any{
			"action": a.appText(actionKey, nil),
		}),
	}
}

func (a *App) openSessionWorkbenchDatabase(
	parent context.Context,
	config connection.ConnectionConfig,
) (db.Database, context.Context, func(), error) {
	if parent == nil {
		parent = context.Background()
	}
	database, err := a.openDatabaseIsolatedWithContext(parent, config)
	if err != nil {
		return nil, nil, func() {}, err
	}
	queryContext, cancel := newQueryExecutionContextWithParent(parent, config)
	db.BindMetadataContext(database, queryContext)
	cleanup := func() {
		db.ClearMetadataContext(database)
		cancel()
		if err := database.Close(); err != nil {
			logger.Error(err, "会话工作台关闭隔离连接失败：%s", formatConnSummary(config))
		}
	}
	return database, queryContext, cleanup, nil
}

func (a *App) sessionActionFailure(
	actionKey string,
	config connection.ConnectionConfig,
	err error,
) connection.QueryResult {
	logger.Error(err, "DBExecuteSessionAction 执行失败：%s", formatConnSummary(config))
	return connection.QueryResult{
		Success: false,
		Message: a.appText("session_workbench.backend.error.action_failed", map[string]any{
			"action": a.appText(actionKey, nil),
			"detail": sessionWorkbenchErrorDetail(err),
		}),
	}
}

func sessionWorkbenchErrorDetail(err error) string {
	return sqlaudit.RedactError(normalizeErrorMessage(err))
}

func sessionWorkbenchAuditStatement(
	capability connection.SessionCapability,
	request connection.SessionActionRequest,
) string {
	verb := "SESSION WORKBENCH ACTION"
	switch request.Action {
	case connection.SessionActionCancelQuery:
		verb = "CANCEL DATABASE QUERY"
	case connection.SessionActionTerminateSession:
		verb = "TERMINATE DATABASE SESSION"
	}

	target := ""
	if request.Action == connection.SessionActionCancelQuery && capability.CancelTarget == connection.SessionActionTargetQueryID {
		target = strings.TrimSpace(request.QueryID)
	} else if request.Action == connection.SessionActionTerminateSession && capability.TerminateTarget == connection.SessionActionTargetQueryID {
		target = strings.TrimSpace(request.QueryID)
	} else {
		target = strings.TrimSpace(request.SessionID)
	}
	serialNumber := strings.TrimSpace(request.SerialNumber)
	instanceID := strings.TrimSpace(request.InstanceID)
	if capability.TerminateRequiresInstanceAndSerial && request.Action == connection.SessionActionTerminateSession &&
		target != "" && serialNumber != "" && instanceID != "" {
		target = strings.Join([]string{target, serialNumber, "@" + instanceID}, ",")
	}
	if target == "" {
		return verb
	}
	return verb + " " + target
}

func (a *App) sessionWorkbenchParentContext() context.Context {
	if a != nil && a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

func sessionWorkbenchActionKey(
	capability connection.SessionCapability,
	action connection.SessionAction,
) (string, bool) {
	switch action {
	case connection.SessionActionCancelQuery:
		return "session_workbench.action.cancel_query", capability.Supported && capability.CanCancelQuery
	case connection.SessionActionTerminateSession:
		return "session_workbench.action.terminate_session", capability.Supported && capability.CanTerminateSession
	default:
		return strings.TrimSpace(string(action)), false
	}
}
