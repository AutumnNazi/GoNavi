package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

func (runtime *HeadlessRuntime) ExportQueryToPath(ctx context.Context, config connection.ConnectionConfig, dbName string, sql string, filePath string, options ExportFileOptions, overwrite bool) (result connection.QueryResult) {
	if runtime == nil || runtime.app == nil {
		return connection.QueryResult{Success: false, Message: "headless runtime is unavailable"}
	}
	if isPluginExportRequest(options) {
		return runtime.app.pluginExportFailure("unsupported_scope")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	queryID := runtime.app.GenerateQueryID()
	traceCtx, requestTrace, ownsRequestTrace := runtime.app.beginQueryRequestTrace(
		ctx,
		config,
		queryID,
		"cli",
		"cli.export",
	)
	ctx = traceCtx
	if ownsRequestTrace {
		defer func() {
			if result.QueryID == "" {
				result.QueryID = queryID
			}
			runtime.app.completeQueryRequestTrace(requestTrace, result)
		}()
	}
	requestTrace.AddEvent("export.accepted", nil)
	sql = strings.TrimSpace(sql)
	options = normalizeExportFileOptions("", options)
	if sql == "" {
		return connection.QueryResult{Success: false, Message: runtime.app.appText("file.backend.error.query_required", nil)}
	}
	config, err := runtime.app.resolveConnectionSecrets(config)
	if err != nil {
		return headlessConnectionFailure(err)
	}
	inspection := runtime.InspectSQL(config, sql)
	if !looksLikeSelectOrWith(sql) || inspection.StatementCount != 1 || !inspection.ReadOnly {
		return headlessPolicyFailure(errors.New(runtime.app.appText("file.backend.error.select_with_query_required", nil)))
	}
	if err := validateExportColumnsSelection(options); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if options.Format == "" {
		return connection.QueryResult{Success: false, Message: "export format is required"}
	}
	target, err := resolveHeadlessExportTarget(filePath, options.Format, overwrite)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if err := ctx.Err(); err != nil {
		return buildQueryExecutionFailure(ctx, err, err.Error(), "")
	}

	runConfig := normalizeRunConfig(config, dbName)
	startedAt := time.Now()
	defer func() {
		result.QueryID = queryID
		runtime.app.recordSQLAuditQuery(sqlAuditQueryInput{
			Config:     runConfig,
			Database:   dbName,
			DBType:     resolveDDLDBType(runConfig),
			QueryID:    queryID,
			SQL:        sql,
			Source:     "cli",
			CommitMode: "auto",
			Duration:   time.Since(startedAt),
			Result:     result,
		})
	}()

	requestTrace.AddEvent("driver.dispatched", nil)
	dbInst, err := runtime.app.getDatabaseWithContext(ctx, runConfig, false)
	if err != nil {
		return headlessConnectionFailure(err)
	}

	return runtime.writeHeadlessExport(ctx, dbInst, runConfig, sql, target, options, overwrite, queryID)
}

func (runtime *HeadlessRuntime) writeHeadlessExport(ctx context.Context, dbInst db.Database, runConfig connection.ConnectionConfig, sql, target string, options ExportFileOptions, overwrite bool, queryID string) connection.QueryResult {
	directory := filepath.Dir(target)
	temporary, err := os.CreateTemp(directory, ".gonavi-export-*.tmp")
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	temporaryPath := temporary.Name()
	cleanupTemporary := true
	defer func() {
		if temporary != nil {
			_ = temporary.Close()
		}
		if cleanupTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}

	rows, columns, err := exportQueryResultToFileWithContext(ctx, temporary, dbInst, runConfig, sql, options, nil)
	if err != nil {
		return buildQueryExecutionFailure(ctx, err, err.Error(), queryID)
	}
	if err := temporary.Sync(); err != nil {
		return buildQueryExecutionFailure(ctx, err, err.Error(), queryID)
	}
	if err := closeExportFile(temporary); err != nil {
		return buildQueryExecutionFailure(ctx, err, err.Error(), queryID)
	}
	temporary = nil
	publish := atomicReplaceSQLAuditFile
	if !overwrite {
		publish = atomicCreateSQLAuditFile
	}
	if err := publish(temporaryPath, target); err != nil {
		return buildQueryExecutionFailure(ctx, err, err.Error(), queryID)
	}
	cleanupTemporary = false
	return connection.QueryResult{
		Success: true,
		Data: map[string]any{
			"path":    target,
			"rows":    rows,
			"columns": columns,
		},
	}

}
