package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/sqlaudit"
	"GoNavi-Wails/internal/sqlparam"
)

// 查询编辑器运行时绑定参数入口。参数值只经 sqlparam 转换后通过驱动绑定
// 通道执行；查询历史、SQL 审计与日志一律记录含 :name 的 SQL 原文，
// 重写后的 SQL 与参数值不落盘。

// QueryParameterStatement 描述一条语句及其扫描到的参数（按首次出现去重）。
type QueryParameterStatement struct {
	Index      int      `json:"index"`
	Text       string   `json:"text"`
	Parameters []string `json:"parameters"`
}

// QueryParameterAnalysis 是 AnalyzeQueryParameters 的权威结果：前端参数面板、
// 绑定对话框与执行前门控都以此为准。
type QueryParameterAnalysis struct {
	Supported      bool                      `json:"supported"`
	Statements     []QueryParameterStatement `json:"statements"`
	ParameterNames []string                  `json:"parameterNames"`
	MessageKey     string                    `json:"messageKey,omitempty"`
	Detail         string                    `json:"detail,omitempty"`
}

// AnalyzeQueryParameters 解析 SQL 的语句拆分与命名参数清单。该接口不建立
// 连接，可在输入过程中防抖调用；能力判定来自静态能力注册表，运行时
// （agent 协议版本、驱动参数化契约）在执行入口再做兜底校验。
func (a *App) AnalyzeQueryParameters(config connection.ConnectionConfig, dbName string, sql string) QueryParameterAnalysis {
	runConfig := normalizeRunConfig(config, dbName)
	resolvedDBType := resolveDDLDBType(runConfig)
	analysis := QueryParameterAnalysis{Statements: []QueryParameterStatement{}}

	capability, ok := resolveParameterBindingCapability(runConfig)
	if !ok || !capability {
		analysis.MessageKey = "query_editor.params.unsupported_driver"
		return analysis
	}

	statementTexts := splitSQLStatementsForDialect(resolvedDBType, sql)
	seen := make(map[string]struct{})
	for idx, statement := range statementTexts {
		trimmed := strings.TrimSpace(statement)
		if trimmed == "" {
			continue
		}
		names := sqlparam.Names(trimmed, sqlparam.OptionsForDBType(resolvedDBType))
		entry := QueryParameterStatement{Index: idx, Text: trimmed, Parameters: []string{}}
		for _, name := range names {
			entry.Parameters = append(entry.Parameters, name)
			if _, dup := seen[name]; !dup {
				seen[name] = struct{}{}
				analysis.ParameterNames = append(analysis.ParameterNames, name)
			}
		}
		analysis.Statements = append(analysis.Statements, entry)
	}
	analysis.Supported = true
	return analysis
}

// resolveParameterBindingCapability 返回该数据源是否声明参数绑定能力。
// ok=false 表示无法归类（未知驱动），按不支持处理。
func resolveParameterBindingCapability(runConfig connection.ConnectionConfig) (bool, bool) {
	sourceType := strings.TrimSpace(runConfig.Type)
	customDriver := strings.EqualFold(sourceType, "custom")
	if customDriver {
		sourceType = strings.TrimSpace(runConfig.Driver)
	}
	if strings.EqualFold(sourceType, "oceanbase") && isOceanBaseOracleProtocol(runConfig) {
		// OceanBase Oracle 协议经 OceanBaseDB 按活动数据库转发，能力与 sql-oracle 一致。
		return true, true
	}
	var capability db.DataSourceCapability
	if customDriver {
		capability = db.ResolveCustomDataSourceCapability(sourceType)
	} else {
		capability = db.ResolveDataSourceCapability(sourceType)
	}
	if strings.TrimSpace(capability.Type) == "" {
		return false, false
	}
	return capability.UI.ParameterBinding, true
}

// DBQueryMultiWithParams 是查询编辑器带参执行入口：SQL 先按方言拆分语句，
// 逐语句用 sqlparam 重写占位符并按名绑定值（同名参数填一次处处生效），
// 再逐语句绑定执行。审计与历史只接收 SQL 原文。
func (a *App) DBQueryMultiWithParams(config connection.ConnectionConfig, dbName string, sql string, queryID string, bindings []connection.QueryParamBinding) connection.QueryResult {
	explicitQuery := strings.TrimSpace(queryID) != ""
	auditSource := "query_editor"
	if !explicitQuery {
		auditSource = "application_api"
	}
	return a.dbQueryMultiWithParams(config, dbName, sql, queryID, bindings, dbQueryMultiAuditOptions{
		auditAll:    explicitQuery || a.webRuntime,
		auditWrites: true,
		source:      auditSource,
	})
}

func (a *App) dbQueryMultiWithParams(
	config connection.ConnectionConfig,
	dbName string,
	query string,
	queryID string,
	bindings []connection.QueryParamBinding,
	auditOptions dbQueryMultiAuditOptions,
) (result connection.QueryResult) {
	runConfig := normalizeRunConfig(config, dbName)
	if queryID == "" {
		queryID = generateQueryID()
	}

	values, err := bindingsToTypedValues(bindings)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error(), QueryID: queryID}
	}

	resolvedDBType := resolveDDLDBType(runConfig)
	query = sanitizeSQLForPgLike(resolvedDBType, query)
	if err := a.ensureDataSourceQueryCapability(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error(), QueryID: queryID}
	}
	if err := ensureConnectionAllowsQuery(config, query); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error(), QueryID: queryID}
	}

	traceContext, requestTrace, ownsRequestTrace := a.beginQueryRequestTrace(
		auditOptions.executionContext,
		runConfig,
		queryID,
		auditOptions.source,
		"database.query_multi_with_params",
	)
	auditOptions.executionContext = traceContext
	defer func() {
		a.recordQueryRequestTraceOutcome(requestTrace, result, ownsRequestTrace)
	}()
	requestTrace.AddEvent("query.accepted", nil)

	trackSQLAudit := auditOptions.auditAll || (auditOptions.auditWrites && containsSQLAuditWrite(resolvedDBType, query))
	auditSource := normalizeSQLAuditSource(auditOptions.source)
	auditStartedAt := time.Now()
	var statementAuditEvents []sqlaudit.Event
	if trackSQLAudit {
		defer func() {
			a.recordSQLAuditQuery(sqlAuditQueryInput{
				Config:     runConfig,
				Database:   dbName,
				DBType:     resolvedDBType,
				QueryID:    queryID,
				SQL:        query,
				Source:     auditSource,
				CommitMode: result.CommitMode,
				Duration:   time.Since(auditStartedAt),
				Result:     result,
			})
		}()
		defer func() {
			a.appendSQLAuditEvents(statementAuditEvents)
		}()
	}
	var queryExecutionDuration time.Duration
	defer func() {
		result.DurationMs = durationMilliseconds(queryExecutionDuration)
	}()
	defer func() {
		if !result.Success {
			return
		}
		durationMs := queryExecutionDuration.Milliseconds()
		a.recordQueryExecution(config, dbName, resolvedDBType, query, durationMs, 0, queryResultRowsReturned(result))
	}()

	ctx, cancel := newQueryExecutionContextWithParent(auditOptions.executionContext, runConfig)
	requestTrace.AddEvent("driver.dispatched", nil)
	cleanupRunningQuery, setRunningQueryCancellable := a.registerRunningQueryWithCancellationCapability(
		queryID,
		cancel,
		true,
		optionalDriverTypeForConnectionConfig(runConfig),
	)
	lifecycle := a.beginQueryExecutionLifecycle(queryID)
	defer func() {
		lifecycle.complete(result)
		cancel()
		cleanupRunningQuery()
	}()

	var dbInst db.Database
	if auditOptions.synchronousConnectionWait {
		dbInst, err = a.getDatabaseSynchronouslyWithContext(ctx, runConfig, false)
	} else {
		dbInst, err = a.getDatabaseWithContext(ctx, runConfig, false)
	}
	if err != nil {
		logger.Error(err, "DBQueryMultiWithParams 获取连接失败：%s", formatConnSummary(runConfig))
		return buildQueryConnectionFailure(err, queryID, auditOptions.classifyConnectionErrors)
	}
	defer func() {
		if result.Success {
			a.markCachedDatabaseHealthy(dbInst, time.Now())
		}
	}()

	if err := ensureDriverSupportsParameterBinding(dbInst); err != nil {
		logger.Error(err, "DBQueryMultiWithParams 驱动不支持参数绑定：%s", formatConnSummary(runConfig))
		return connection.QueryResult{Success: false, Message: err.Error(), QueryID: queryID}
	}

	statementTexts := splitSQLStatementsForDialect(resolvedDBType, query)
	stmts, err := bindParameterizedStatements(statementTexts, resolvedDBType, values)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error(), QueryID: queryID}
	}

	resultSets, executedCount, failedIndex, auditEvents, execErr := a.executeParameterizedStatements(
		ctx, dbInst, nil, runConfig, resolvedDBType, stmts,
		trackSQLAudit, auditSource, auditStartedAt, queryID, "", setRunningQueryCancellable, &queryExecutionDuration,
	)
	statementAuditEvents = auditEvents
	if execErr != nil {
		message := a.appText("db.backend.error.multi_statement_execution_failed", map[string]any{
			"index":  failedIndex,
			"detail": execErr.Error(),
		})
		logger.Error(execErr, "DBQueryMultiWithParams 语句执行失败：%s index=%d", formatConnSummary(runConfig), failedIndex)
		return summarizeMultiStatementResult(connection.QueryResult{
			Success: false,
			Message: message,
			QueryID: queryID,
		}, executedCount, failedIndex, sqlaudit.BoundaryModeImplicit, false)
	}

	applyRowBudgetTruncation(resultSets, db.NewRowBudget(0))
	return summarizeMultiStatementResult(connection.QueryResult{
		Success: true,
		Data:    resultSets,
		QueryID: queryID,
	}, executedCount, 0, sqlaudit.BoundaryModeImplicit, false)
}

// DBQueryMultiWithParamsInTransaction 在编辑器托管事务内执行参数化 SQL。
func (a *App) DBQueryMultiWithParamsInTransaction(transactionID string, sql string, queryID string, bindings []connection.QueryParamBinding) (result connection.QueryResult) {
	transactionID = strings.TrimSpace(transactionID)
	if transactionID == "" {
		return connection.QueryResult{Success: false, Message: a.appText("db.backend.error.transaction_id_required", nil), QueryID: queryID}
	}
	if queryID == "" {
		queryID = generateQueryID()
	}

	a.sqlTransactionMu.Lock()
	tx, ok := a.sqlTransactions[transactionID]
	a.sqlTransactionMu.Unlock()
	if !ok || tx == nil || tx.execer == nil {
		return connection.QueryResult{Success: false, Message: a.appText("db.backend.error.transaction_not_found", nil), QueryID: queryID}
	}

	runConfig := tx.config
	if strings.TrimSpace(runConfig.Type) == "" {
		runConfig.Type = tx.dbType
	}
	ctx, cancel := newQueryExecutionContext(runConfig)
	cleanupRunningQuery := a.registerRunningQuery(queryID, cancel, true, optionalDriverTypeForConnectionConfig(runConfig))
	lifecycle := a.beginQueryExecutionLifecycle(queryID)
	defer func() {
		lifecycle.complete(result)
		cancel()
		cleanupRunningQuery()
	}()

	tx.mu.Lock()
	defer tx.mu.Unlock()
	if tx.finished || tx.execer == nil {
		return connection.QueryResult{Success: false, Message: a.appText("db.backend.error.transaction_not_found", nil), QueryID: queryID}
	}

	var queryExecutionDuration time.Duration
	defer func() {
		result.DurationMs = durationMilliseconds(queryExecutionDuration)
	}()
	defer func() {
		if !result.Success {
			return
		}
		durationMs := queryExecutionDuration.Milliseconds()
		a.recordQueryExecution(runConfig, "", tx.dbType, sql, durationMs, 0, queryResultRowsReturned(result))
	}()

	if err := ensureDriverSupportsParameterBinding(tx.execer); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error(), QueryID: queryID, TransactionID: transactionID, TransactionPending: true}
	}
	values, err := bindingsToTypedValues(bindings)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error(), QueryID: queryID, TransactionID: transactionID, TransactionPending: true}
	}

	resolvedDBType := resolveDDLDBType(runConfig)
	query := sanitizeSQLForPgLike(tx.dbType, sql)
	statementTexts := splitSQLStatementsForDialect(tx.dbType, query)
	stmts, err := bindParameterizedStatements(statementTexts, tx.dbType, values)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error(), QueryID: queryID, TransactionID: transactionID, TransactionPending: true}
	}

	queryStartedAt := time.Now()
	statementAuditEvents := make([]sqlaudit.Event, 0, len(stmts))
	resultSets, _, _, _, execErr := a.executeParameterizedStatements(
		ctx, nil, tx.execer, runConfig, resolvedDBType, stmts,
		true, normalizeSQLAuditSource("query_editor"), queryStartedAt, queryID, transactionID, nil, &queryExecutionDuration,
	)
	a.appendSQLAuditEvents(statementAuditEvents)
	if execErr != nil {
		logger.Error(execErr, "DBQueryMultiWithParamsInTransaction 执行失败：id=%s dbType=%s", transactionID, tx.dbType)
		return connection.QueryResult{
			Success:            false,
			Message:            execErr.Error(),
			QueryID:            queryID,
			TransactionID:      transactionID,
			TransactionPending: true,
		}
	}

	return connection.QueryResult{
		Success:            true,
		Data:               resultSets,
		QueryID:            queryID,
		TransactionID:      transactionID,
		TransactionPending: true,
	}
}

// bindingsToTypedValues 把前端按名提交的绑定值收敛为 sqlparam 的输入；
// 同名绑定取最后一次输入，缺 Type 时默认字符串。
func bindingsToTypedValues(bindings []connection.QueryParamBinding) (map[string]sqlparam.TypedValue, error) {
	values := make(map[string]sqlparam.TypedValue, len(bindings))
	for _, binding := range bindings {
		name := strings.TrimSpace(binding.Name)
		if name == "" {
			return nil, fmt.Errorf("%w：参数名不能为空", sqlparam.ErrInvalidValue)
		}
		typ := strings.TrimSpace(binding.Type)
		if typ == "" {
			typ = sqlparam.TypeString
		}
		values[name] = sqlparam.TypedValue{Type: typ, Value: binding.Value}
	}
	return values, nil
}

type parameterizedStatement struct {
	text string // SQL 原文（审计与历史只使用该字段）
	sql  string // 按方言重写占位符后的可执行 SQL
	args []any  // 位置绑定参数
}

// bindParameterizedStatements 对每条语句做占位符重写与值绑定；缺值立即返回
// 可操作错误（包含缺失参数名），不执行任何语句。
func bindParameterizedStatements(statementTexts []string, dbType string, values map[string]sqlparam.TypedValue) ([]parameterizedStatement, error) {
	stmts := make([]parameterizedStatement, 0, len(statementTexts))
	for _, statement := range statementTexts {
		trimmed := strings.TrimSpace(statement)
		if trimmed == "" {
			continue
		}
		bound, err := sqlparam.Bind(trimmed, dbType, values)
		if err != nil {
			return nil, err
		}
		stmts = append(stmts, parameterizedStatement{text: trimmed, sql: bound.SQL, args: bound.Args})
	}
	if len(stmts) == 0 {
		return nil, errors.New("没有可执行的 SQL 语句")
	}
	return stmts, nil
}

// ensureDriverSupportsParameterBinding 是执行时的兜底校验：静态能力声明之外的
// 运行时差异（自定义驱动、agent 协议版本）统一由参数化契约断言拦截。
func ensureDriverSupportsParameterBinding(target any) error {
	switch t := target.(type) {
	case db.QueryArgsContexter:
		_ = t
		return nil
	case db.StatementQueryArgsExecer:
		_ = t
		return nil
	default:
		return errors.New("当前驱动不支持参数绑定")
	}
}

// executeParameterizedStatements 逐语句绑定执行。
// 目标优先级：托管会话（事务路径）→ 共享连接。读语句与“先查询后判定”的
// 写语句走查询契约，其余走执行契约；审计事件只携带 SQL 原文。
func (a *App) executeParameterizedStatements(
	ctx context.Context,
	dbInst db.Database,
	session db.StatementExecer,
	runConfig connection.ConnectionConfig,
	resolvedDBType string,
	stmts []parameterizedStatement,
	trackSQLAudit bool,
	auditSource string,
	auditStartedAt time.Time,
	queryID string,
	transactionID string,
	setRunningQueryCancellable func(bool),
	executionDuration *time.Duration,
) ([]connection.ResultSetData, int, int, []sqlaudit.Event, error) {
	resultSets := make([]connection.ResultSetData, 0, len(stmts))
	executedCount := 0
	statementAuditEvents := make([]sqlaudit.Event, 0, len(stmts))
	for idx, stmt := range stmts {
		if budget := db.RowBudgetFromContext(ctx); budget != nil && budget.Truncated() {
			// 前一语句已达行预算并停止读取，剩余语句不再执行。
			break
		}
		statementStartedAt := time.Now()
		statementErr := func() error {
			isReadStmt := isReadOnlySQLQuery(runConfig.Type, stmt.text)
			tryQueryStmtFirst := shouldTryQueryResultFirst(runConfig.Type, stmt.text)
			if isReadStmt || tryQueryStmtFirst {
				if setRunningQueryCancellable != nil {
					setRunningQueryCancellable(true)
				}
				var data []map[string]interface{}
				var columns []string
				var queryErr error
				if session != nil {
					if target, ok := session.(db.StatementQueryArgsExecer); ok {
						data, columns, queryErr = target.QueryContextWithArgs(ctx, stmt.sql, stmt.args)
					} else {
						queryErr = errors.New("当前事务会话不支持参数绑定")
					}
				} else if target, ok := dbInst.(db.QueryArgsContexter); ok {
					data, columns, queryErr = target.QueryContextWithArgs(ctx, stmt.sql, stmt.args)
				} else {
					queryErr = errors.New("当前驱动不支持参数绑定")
				}
				if queryErr == nil {
					resultSets = append(resultSets, connection.ResultSetData{Rows: data, Columns: columns})
				}
				return queryErr
			}
			if setRunningQueryCancellable != nil {
				setRunningQueryCancellable(false)
			}
			var affected int64
			var execErr error
			if session != nil {
				if target, ok := session.(db.StatementExecArgsExecer); ok {
					affected, execErr = target.ExecContextWithArgs(ctx, stmt.sql, stmt.args)
				} else {
					execErr = errors.New("当前事务会话不支持参数绑定")
				}
			} else if target, ok := dbInst.(db.ExecArgsContexter); ok {
				affected, execErr = target.ExecContextWithArgs(ctx, stmt.sql, stmt.args)
			} else {
				execErr = errors.New("当前驱动不支持参数绑定")
			}
			if execErr == nil {
				resultSets = append(resultSets, connection.ResultSetData{
					Rows:    []map[string]interface{}{{"affectedRows": affected}},
					Columns: []string{"affectedRows"},
				})
			}
			return execErr
		}()
		*executionDuration += time.Since(statementStartedAt)
		executedCount++

		if trackSQLAudit {
			statementAuditEvents = append(statementAuditEvents, a.buildParameterizedStatementAuditEvent(
				runConfig, resolvedDBType, queryID, transactionID, auditSource, auditStartedAt,
				stmt, idx+1, len(stmts), statementStartedAt, statementErr,
			))
		}
		if statementErr != nil {
			if errors.Is(statementErr, context.Canceled) || errors.Is(statementErr, context.DeadlineExceeded) {
				if shouldRefreshCachedConnection(statementErr) {
					a.invalidateCachedDatabase(runConfig, statementErr)
				}
			}
			statementErr = classifyDispatchedWriteError(statementErr)
			return resultSets, executedCount - 1, idx + 1, statementAuditEvents, statementErr
		}
	}
	return resultSets, executedCount, 0, statementAuditEvents, nil
}

// buildParameterizedStatementAuditEvent 构造单语句审计事件；SQL 字段是含
// :name 的原文，参数值不可能进入事件。
func (a *App) buildParameterizedStatementAuditEvent(
	runConfig connection.ConnectionConfig,
	resolvedDBType string,
	queryID string,
	transactionID string,
	auditSource string,
	auditStartedAt time.Time,
	stmt parameterizedStatement,
	statementIndex int,
	statementCount int,
	startedAt time.Time,
	statementErr error,
) sqlaudit.Event {
	boundaryMode, commitMode := sqlAuditTextTransactionMetadata(stmt.text, false)
	event := buildSQLAuditTransactionEvent(sqlAuditTransactionEventInput{
		Config:         runConfig,
		Database:       runConfig.Database,
		DBType:         resolvedDBType,
		QueryID:        queryID,
		EventType:      "query_statement",
		Status:         sqlAuditStatusFromError(statementErr),
		Source:         auditSource,
		CommitMode:     commitMode,
		BoundaryMode:   boundaryMode,
		SQL:            stmt.text,
		StatementIndex: statementIndex,
		StatementCount: statementCount,
		ExecutedCount:  executedStatementCount(statementErr),
		FailedIndex:    failedStatementIndex(statementIndex, statementErr),
		OutcomeUnknown: writeExecutionOutcomeUnknown(context.Background(), statementErr),
		Duration:       time.Since(startedAt),
		Err:            statementErr,
	})
	event.Timestamp = time.Now().UnixMilli()
	return event
}
