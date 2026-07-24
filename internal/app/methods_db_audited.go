package app

import (
	"strings"
	"time"

	"GoNavi-Wails/internal/connection"
)

type sqlAuditUserActionOptions struct {
	StatementCount *int
	SafeError      *string
}

// beginSQLAuditUserAction returns a deferred recorder for exported user-facing
// write helpers that already own execution, validation, and dialect handling.
// The supplied text is an operation descriptor or generated statement and must
// never contain row values or message payloads.
func (a *App) beginSQLAuditUserAction(
	config connection.ConnectionConfig,
	dbName string,
	source string,
	sqlText *string,
	result *connection.QueryResult,
	statementCount ...*int,
) func() {
	options := sqlAuditUserActionOptions{}
	if len(statementCount) > 0 {
		options.StatementCount = statementCount[0]
	}
	return a.beginSQLAuditUserActionWithOptions(config, dbName, source, sqlText, result, options)
}

func (a *App) beginSQLAuditUserActionWithOptions(
	config connection.ConnectionConfig,
	dbName string,
	source string,
	sqlText *string,
	result *connection.QueryResult,
	options sqlAuditUserActionOptions,
) func() {
	startedAt := time.Now()
	queryID := generateQueryID()
	runConfig := normalizeRunConfig(config, dbName)
	return func() {
		if result == nil {
			return
		}
		statement := ""
		if sqlText != nil {
			statement = strings.TrimSpace(*sqlText)
		}
		resolvedStatementCount := 0
		if options.StatementCount != nil {
			resolvedStatementCount = *options.StatementCount
		}
		auditResult := *result
		if !auditResult.Success && options.SafeError != nil {
			auditResult.Message = strings.TrimSpace(*options.SafeError)
		}
		a.recordSQLAuditQuery(sqlAuditQueryInput{
			Config:         runConfig,
			Database:       dbName,
			DBType:         resolveDDLDBType(runConfig),
			QueryID:        queryID,
			SQL:            statement,
			Source:         source,
			CommitMode:     "auto",
			Duration:       time.Since(startedAt),
			StatementCount: resolvedStatementCount,
			Result:         auditResult,
		})
	}
}

// DBQueryAudited executes one explicit application-level user action and writes
// exactly one SQL audit event without adding it to slow-query history.
func (a *App) DBQueryAudited(
	config connection.ConnectionConfig,
	dbName string,
	query string,
	source string,
) connection.QueryResult {
	queryID := generateQueryID()
	return a.dbQueryWithCancel(config, dbName, query, queryID, dbQueryAuditOptions{
		auditAll:    true,
		auditWrites: true,
		source:      normalizeSQLAuditUserActionSource(source),
	})
}

// DBQueryAI is the dedicated entry point used by GoNavi's built-in AI tool
// runtime. The audit source describes this called entry point; it is not an
// unforgeable actor identity or security provenance claim.
func (a *App) DBQueryAI(
	config connection.ConnectionConfig,
	dbName string,
	query string,
) connection.QueryResult {
	return a.dbQueryWithCancel(config, dbName, query, "", dbQueryAuditOptions{
		auditAll:    true,
		auditWrites: true,
		source:      "ai_action",
	})
}

// MCPQueryExecutor is a narrow adapter for the MCP server. Keeping it separate
// from App's Wails-bound method set makes the mcp source a backend-owned fact
// rather than a source string accepted from a browser or desktop caller.
type MCPQueryExecutor struct {
	app *App
}

func NewMCPQueryExecutor(app *App) *MCPQueryExecutor {
	return &MCPQueryExecutor{app: app}
}

func (executor *MCPQueryExecutor) DBQueryMulti(
	config connection.ConnectionConfig,
	dbName string,
	query string,
) connection.QueryResult {
	if executor == nil || executor.app == nil {
		return connection.QueryResult{Success: false, Message: "MCP query executor is unavailable"}
	}
	return executor.app.dbQueryMulti(config, dbName, query, "", dbQueryMultiAuditOptions{
		auditAll:    true,
		auditWrites: true,
		source:      "mcp",
	})
}

func normalizeSQLAuditUserActionSource(source string) string {
	switch normalized := strings.ToLower(strings.TrimSpace(source)); normalized {
	case "data_editor", "table_designer", "object_editor", "message_publish":
		return normalized
	default:
		return "application_api"
	}
}
