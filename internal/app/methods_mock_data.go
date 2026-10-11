package app

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/mockdata"
	"GoNavi-Wails/internal/sqlaudit"
	"GoNavi-Wails/internal/uievents"
)

// mockDataProgressEvent 是写入进度事件名，负载与表数据导入的 import:progress 同形。
const mockDataProgressEvent = "mockdata:progress"

// MockDataRunOptions 控制一次写入任务。JobID 同时用于进度事件过滤与 CancelQuery 取消。
type MockDataRunOptions struct {
	JobID           string `json:"jobId"`
	BatchSize       int    `json:"batchSize,omitempty"`
	ContinueOnError bool   `json:"continueOnError,omitempty"`
}

// MockDataColumn 是检查结果中的一列：画像、可选规则、是否必须给值、外键父表可选值个数。
type MockDataColumn struct {
	Profile        mockdata.Profile `json:"profile"`
	AllowedKinds   []mockdata.Kind  `json:"allowedKinds"`
	Required       bool             `json:"required"`
	ReferenceCount int              `json:"referenceCount"`
}

// MockDataInspection 是 MockDataInspect 的返回负载。
type MockDataInspection struct {
	DBType      string                `json:"dbType"`
	Family      string                `json:"family"`
	Columns     []MockDataColumn      `json:"columns"`
	Plans       []mockdata.ColumnPlan `json:"plans"`
	MaxRowCount int                   `json:"maxRowCount"`
}

// MockDataPreviewResult 是 MockDataPreview 的返回负载；行里的值都是文本或 null。
type MockDataPreviewResult struct {
	Columns []string                 `json:"columns"`
	Rows    []map[string]interface{} `json:"rows"`
}

// MockDataRunResult 是 MockDataGenerate 的返回负载。
type MockDataRunResult struct {
	Total          int      `json:"total"`
	Success        int      `json:"success"`
	Failed         int      `json:"failed"`
	ErrorLogs      []string `json:"errorLogs,omitempty"`
	StoppedOnError bool     `json:"stoppedOnError,omitempty"`
	OutcomeUnknown bool     `json:"outcomeUnknown,omitempty"`
	Cancelled      bool     `json:"cancelled,omitempty"`
	DurationMs     int64    `json:"durationMs"`
}

// MockDataInspect 读取表结构，返回每列的画像与推荐的生成规则。只读。
func (a *App) MockDataInspect(config connection.ConnectionConfig, dbName, tableName, locale string) connection.QueryResult {
	return a.mockDataInspectContext(context.Background(), config, dbName, tableName, locale)
}

// MockDataPreview 按计划生成前若干行供预览，不写库。同一计划的预览就是实际写入的前几行。
func (a *App) MockDataPreview(config connection.ConnectionConfig, dbName, tableName string, plan mockdata.Plan) connection.QueryResult {
	return a.mockDataPreviewContext(context.Background(), config, dbName, tableName, plan)
}

// MockDataGenerate 按计划生成并写入目标表，进度经 mockdata:progress 推送，可用 CancelQuery(jobId) 取消。
func (a *App) MockDataGenerate(config connection.ConnectionConfig, dbName, tableName string, plan mockdata.Plan, options MockDataRunOptions) connection.QueryResult {
	return a.mockDataGenerateContext(context.Background(), config, dbName, tableName, plan, options)
}

func (a *App) mockDataInspectContext(ctx context.Context, config connection.ConnectionConfig, dbName, tableName, locale string) connection.QueryResult {
	if message := a.mockDataUnsupportedMessage(config); message != "" {
		return connection.QueryResult{Success: false, Message: message}
	}
	table, err := a.loadMockDataTable(ctx, config, dbName, tableName)
	if err != nil {
		logger.Error(err, "模拟数据读取表结构失败：%s 表=%s.%s", formatConnSummary(config), dbName, tableName)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	a.mockDataTables.put(mockDataTableCacheKey(config, dbName, tableName), table, time.Now())
	inspection := MockDataInspection{
		DBType:      table.dbType,
		Family:      string(table.family),
		Columns:     make([]MockDataColumn, 0, len(table.profiles)),
		Plans:       mockdata.SuggestPlans(table.profiles, locale, time.Now()),
		MaxRowCount: mockdata.MaxRowCount,
	}
	for _, profile := range table.profiles {
		inspection.Columns = append(inspection.Columns, MockDataColumn{
			Profile:        profile,
			AllowedKinds:   mockdata.AllowedKinds(profile.Category),
			Required:       profile.Required(),
			ReferenceCount: len(table.refs[strings.ToLower(profile.Name)]),
		})
	}
	return connection.QueryResult{Success: true, Data: inspection}
}

func (a *App) mockDataPreviewContext(ctx context.Context, config connection.ConnectionConfig, dbName, tableName string, plan mockdata.Plan) connection.QueryResult {
	if message := a.mockDataUnsupportedMessage(config); message != "" {
		return connection.QueryResult{Success: false, Message: message}
	}
	// 预览只做计算，复用最近一次读表结果；缓存过期才重新读表。
	cacheKey := mockDataTableCacheKey(config, dbName, tableName)
	table, cached := a.mockDataTables.get(cacheKey, time.Now())
	if !cached {
		loaded, err := a.loadMockDataTable(ctx, config, dbName, tableName)
		if err != nil {
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		a.mockDataTables.put(cacheKey, loaded, time.Now())
		table = loaded
	}
	// 先按完整行数校验（唯一取值够不够、序列会不会溢出），再只产出预览行。
	if _, err := mockdata.NewProducer(plan, table.profiles, table.refs); err != nil {
		return connection.QueryResult{Success: false, Message: a.mockDataErrorMessage(err)}
	}
	previewPlan := plan
	previewPlan.RowCount = min(plan.RowCount, mockdata.PreviewRowCount)
	producer, err := mockdata.NewProducer(previewPlan, table.profiles, table.refs)
	if err != nil {
		return connection.QueryResult{Success: false, Message: a.mockDataErrorMessage(err)}
	}
	preview := MockDataPreviewResult{Columns: producer.Columns(), Rows: make([]map[string]interface{}, 0, previewPlan.RowCount)}
	for {
		row, ok, err := producer.Next()
		if err != nil {
			return connection.QueryResult{Success: false, Message: a.mockDataErrorMessage(err)}
		}
		if !ok {
			break
		}
		preview.Rows = append(preview.Rows, row)
	}
	return connection.QueryResult{Success: true, Data: preview}
}

func (a *App) mockDataGenerateContext(
	parent context.Context,
	config connection.ConnectionConfig,
	dbName, tableName string,
	plan mockdata.Plan,
	options MockDataRunOptions,
) (result connection.QueryResult) {
	dbType := resolveDDLDBType(config)
	schemaName, pureTableName := normalizeSchemaAndTableByType(dbType, dbName, tableName)
	auditSQL := "GENERATE MOCK DATA INTO " + quoteTableIdentByType(dbType, schemaName, pureTableName) + " ROWS " + strconv.Itoa(plan.RowCount)
	auditSafeError := "mock data generation failed"
	defer a.beginSQLAuditUserActionWithOptions(config, dbName, "mock_data", &auditSQL, &result, sqlAuditUserActionOptions{
		SafeError: &auditSafeError,
	})()
	if err := ensureConnectionAllowsDataEdit(config, "connection.backend.action.generate_mock_data"); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if err := ensureConnectionAllowsDataImport(config, "connection.backend.action.generate_mock_data"); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if message := a.mockDataUnsupportedMessage(config); message != "" {
		return connection.QueryResult{Success: false, Message: message}
	}
	jobCtx, cancel := context.WithCancel(parent)
	defer cancel()
	jobID := strings.TrimSpace(options.JobID)
	if jobID == "" {
		jobID = "mockdata-" + generateQueryID()
	}
	cleanup, registered := a.registerExclusiveRunningQuery(jobID, cancel, true)
	if !registered {
		return connection.QueryResult{Success: false, Message: a.appText("mock_data.backend.error.job_running", nil)}
	}
	defer cleanup()

	// 写入始终重新读表：约束、父表取值和序列起点要以写入时为准；写完清掉预览缓存。
	cacheKey := mockDataTableCacheKey(config, dbName, tableName)
	defer a.mockDataTables.drop(cacheKey)
	table, err := a.loadMockDataTable(jobCtx, config, dbName, tableName)
	if err != nil {
		return a.mockDataFailure(jobCtx, err)
	}
	producer, err := mockdata.NewProducer(plan, table.profiles, table.refs)
	if err != nil {
		return connection.QueryResult{Success: false, Message: a.mockDataErrorMessage(err)}
	}
	return a.runMockDataWrite(jobCtx, table, tableName, producer, jobID, options)
}

// runMockDataWrite 复用表数据导入的批量写入器：各驱动的 ApplyChanges 负责方言差异（占位符、批量上限、逐行插入）。
func (a *App) runMockDataWrite(ctx context.Context, table *mockDataTable, tableName string, producer *mockdata.Producer, jobID string, options MockDataRunOptions) connection.QueryResult {
	startedAt := time.Now()
	writer := newImportDatabaseRowWriterWithOptions(table.dbInst, table.dbType, tableName, newImportColumnTypeLookup(table.columns), ImportFileOptions{})
	batchSize := options.BatchSize
	if batchSize <= 0 || batchSize > defaultImportApplyBatchSize {
		batchSize = defaultImportApplyBatchSize
	}
	consumer := newImportBatchConsumer(writer, batchSize, producer.Total(), true, options.ContinueOnError, func(state importProgressState) {
		uievents.Emit(a.ctx, mockDataProgressEvent, state)
	})
	consumer.SetContext(ctx)
	consumer.jobID = jobID
	runErr := consumer.SetColumns(producer.Columns())
	for runErr == nil {
		row, ok, err := producer.Next()
		if err != nil {
			runErr = err
			break
		}
		if !ok {
			runErr = consumer.Flush()
			break
		}
		runErr = consumer.ConsumeRow(row)
	}
	outcome := consumer.Result()
	payload := MockDataRunResult{
		Total:          producer.Total(),
		Success:        outcome.Success,
		Failed:         outcome.Failed,
		ErrorLogs:      outcome.ErrorLogs,
		StoppedOnError: outcome.StoppedOnError,
		OutcomeUnknown: outcome.OutcomeUnknown,
		DurationMs:     time.Since(startedAt).Milliseconds(),
	}
	if runErr == nil && outcome.Failed == 0 {
		return connection.QueryResult{Success: true, Data: payload, Message: a.appText("mock_data.backend.done", map[string]any{"count": outcome.Success})}
	}
	if errors.Is(runErr, context.Canceled) || ctx.Err() != nil {
		payload.Cancelled = true
		return connection.QueryResult{Success: false, Data: payload, Message: a.appText("mock_data.backend.cancelled", map[string]any{"count": outcome.Success})}
	}
	message := a.appText("mock_data.backend.partial", map[string]any{"success": outcome.Success, "failed": outcome.Failed})
	var planErr *mockdata.PlanError
	if errors.As(runErr, &planErr) {
		message = a.mockDataErrorMessage(runErr)
	}
	if runErr != nil {
		logger.Warnf("模拟数据写入中止：表=%s 已成功=%d 错误=%s", tableName, outcome.Success, sqlaudit.RedactError(runErr.Error()))
	}
	return connection.QueryResult{Success: false, Data: payload, Message: message}
}

func (a *App) mockDataFailure(ctx context.Context, err error) connection.QueryResult {
	if ctx.Err() != nil {
		return connection.QueryResult{Success: false, Data: MockDataRunResult{Cancelled: true}, Message: a.appText("mock_data.backend.cancelled", map[string]any{"count": 0})}
	}
	return connection.QueryResult{Success: false, Message: err.Error()}
}

// mockDataUnsupportedMessage 按能力契约判断数据源是否支持生成模拟数据，不支持时返回提示文案。
func (a *App) mockDataUnsupportedMessage(config connection.ConnectionConfig) string {
	if db.ResolveDataSourceCapability(config.Type).UI.MockData {
		return ""
	}
	return a.appText("mock_data.backend.error.unsupported_source", map[string]any{"type": config.Type})
}

// mockDataErrorMessage 把计划错误翻译成界面文案；其余错误原样返回。
func (a *App) mockDataErrorMessage(err error) string {
	var planErr *mockdata.PlanError
	if !errors.As(err, &planErr) {
		return err.Error()
	}
	return a.appText("mock_data.backend.error."+planErr.Code, map[string]any{
		"column": planErr.Column,
		"detail": planErr.Detail,
	})
}
