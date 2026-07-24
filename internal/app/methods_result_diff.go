package app

import (
	"fmt"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/resultdiff"
)

// ResultDiffStartRequest 前端启动比对请求（含连接配置）。
type ResultDiffStartRequest struct {
	JobID           string                      `json:"jobId,omitempty"`
	Config          connection.ConnectionConfig `json:"config"`
	Database        string                      `json:"database"`
	Left            resultdiff.DatasetSpec      `json:"left"`
	Right           resultdiff.DatasetSpec      `json:"right"`
	KeyColumns      []string                    `json:"keyColumns"`
	CompareColumns  []string                    `json:"compareColumns,omitempty"`
	IgnoreColumns   []string                    `json:"ignoreColumns,omitempty"`
	Options         resultdiff.CompareOptions   `json:"options"`
	MaxRowsPerSide  int                         `json:"maxRowsPerSide,omitempty"`
	IncludeSameRows bool                        `json:"includeSameRows,omitempty"`
}

// ResultDiffStart 启动结果集比对。
// left/right mode=sql 时在服务端执行查询并全量装载；mode=rows 时创建会话等待 UploadChunk。
func (a *App) ResultDiffStart(req ResultDiffStartRequest) connection.QueryResult {
	if a == nil || a.resultDiffManager == nil {
		return connection.QueryResult{Success: false, Message: defaultAppText("result_diff.backend.error.manager_unavailable", nil)}
	}
	if len(req.KeyColumns) == 0 {
		return connection.QueryResult{Success: false, Message: a.appText("result_diff.backend.error.key_columns_required", nil)}
	}

	leftMode := normalizeDatasetMode(req.Left.Mode)
	rightMode := normalizeDatasetMode(req.Right.Mode)
	if leftMode == "" || rightMode == "" {
		return connection.QueryResult{Success: false, Message: a.appText("result_diff.backend.error.invalid_dataset_mode", nil)}
	}

	startReq := resultdiff.StartRequest{
		JobID:           req.JobID,
		Database:        req.Database,
		Left:            req.Left,
		Right:           req.Right,
		KeyColumns:      req.KeyColumns,
		CompareColumns:  req.CompareColumns,
		IgnoreColumns:   req.IgnoreColumns,
		Options:         req.Options,
		MaxRowsPerSide:  req.MaxRowsPerSide,
		IncludeSameRows: req.IncludeSameRows,
	}
	session, releaseSession := a.resultDiffManager.CreateWithLease(startReq)
	if session == nil {
		return connection.QueryResult{Success: false, Message: a.appText("result_diff.backend.error.manager_unavailable", nil)}
	}
	defer func() {
		releaseSession()
	}()

	// 纯 rows 模式：仅创建会话，等待分块上传后 ResultDiffCompute
	if leftMode == resultdiff.DatasetModeRows && rightMode == resultdiff.DatasetModeRows {
		// 若请求内已内嵌 rows，直接装载
		if len(req.Left.Rows) > 0 || len(req.Right.Rows) > 0 {
			if err := session.SetLoaded(req.Left.Columns, req.Left.Rows, req.Right.Columns, req.Right.Rows); err != nil {
				a.resultDiffManager.Close(session.ID)
				return connection.QueryResult{Success: false, Message: err.Error()}
			}
			summary, err := session.Compute()
			if err != nil {
				a.resultDiffManager.Close(session.ID)
				return connection.QueryResult{Success: false, Message: err.Error()}
			}
			return connection.QueryResult{
				Success: true,
				Message: a.appText("result_diff.backend.result.ready", nil),
				Data:    resultdiff.StartResult{JobID: session.ID, Summary: summary},
			}
		}
		return connection.QueryResult{
			Success: true,
			Message: a.appText("result_diff.backend.result.session_created", nil),
			Data:    resultdiff.StartResult{JobID: session.ID},
		}
	}

	// 需要 SQL 装载时解析连接
	resolved, err := a.resolveConnectionSecrets(req.Config)
	if err != nil {
		a.resultDiffManager.Close(session.ID)
		return connection.QueryResult{
			Success: false,
			Message: a.appText("result_diff.backend.error.resolve_secret_failed", map[string]any{"detail": err.Error()}),
		}
	}

	var leftCols, rightCols []string
	var leftRows, rightRows []map[string]interface{}

	if leftMode == resultdiff.DatasetModeSQL {
		leftRows, leftCols, err = a.loadResultDiffSQL(resolved, req.Database, req.Left.SQL, session.MaxRowsPerSide)
		if err != nil {
			a.resultDiffManager.Close(session.ID)
			return connection.QueryResult{
				Success: false,
				Message: a.appText("result_diff.backend.error.load_left_failed", map[string]any{"detail": err.Error()}),
			}
		}
	} else {
		leftCols = req.Left.Columns
		leftRows = req.Left.Rows
	}

	if rightMode == resultdiff.DatasetModeSQL {
		rightRows, rightCols, err = a.loadResultDiffSQL(resolved, req.Database, req.Right.SQL, session.MaxRowsPerSide)
		if err != nil {
			a.resultDiffManager.Close(session.ID)
			return connection.QueryResult{
				Success: false,
				Message: a.appText("result_diff.backend.error.load_right_failed", map[string]any{"detail": err.Error()}),
			}
		}
	} else {
		rightCols = req.Right.Columns
		rightRows = req.Right.Rows
	}

	// 混合模式：rows 侧可能稍后上传
	if leftMode == resultdiff.DatasetModeRows && len(leftRows) == 0 {
		// 先装 right，left 等待 upload。重新创建可避免 SetLoaded 把两侧都
		// 标记完成；切换 lease 前先结束旧会话的装载保护。
		releaseSession()
		a.resultDiffManager.Close(session.ID)
		session, releaseSession = a.resultDiffManager.CreateWithLease(startReq)
		if session == nil {
			return connection.QueryResult{Success: false, Message: a.appText("result_diff.backend.error.manager_unavailable", nil)}
		}
		if err := session.AppendRows("right", rightCols, rightRows, true); err != nil {
			a.resultDiffManager.Close(session.ID)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{
			Success: true,
			Message: a.appText("result_diff.backend.result.session_created", nil),
			Data:    resultdiff.StartResult{JobID: session.ID},
		}
	}
	if rightMode == resultdiff.DatasetModeRows && len(rightRows) == 0 {
		releaseSession()
		a.resultDiffManager.Close(session.ID)
		session, releaseSession = a.resultDiffManager.CreateWithLease(startReq)
		if session == nil {
			return connection.QueryResult{Success: false, Message: a.appText("result_diff.backend.error.manager_unavailable", nil)}
		}
		if err := session.AppendRows("left", leftCols, leftRows, true); err != nil {
			a.resultDiffManager.Close(session.ID)
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return connection.QueryResult{
			Success: true,
			Message: a.appText("result_diff.backend.result.session_created", nil),
			Data:    resultdiff.StartResult{JobID: session.ID},
		}
	}

	if err := session.SetLoaded(leftCols, leftRows, rightCols, rightRows); err != nil {
		a.resultDiffManager.Close(session.ID)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	summary, err := session.Compute()
	if err != nil {
		a.resultDiffManager.Close(session.ID)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{
		Success: true,
		Message: a.appText("result_diff.backend.result.ready", nil),
		Data:    resultdiff.StartResult{JobID: session.ID, Summary: summary},
	}
}

// ResultDiffUploadChunk 快照模式分块上传行。
func (a *App) ResultDiffUploadChunk(req resultdiff.UploadChunkRequest) connection.QueryResult {
	if a == nil || a.resultDiffManager == nil {
		return connection.QueryResult{Success: false, Message: defaultAppText("result_diff.backend.error.manager_unavailable", nil)}
	}
	session, err := a.resultDiffManager.Get(req.JobID)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if err := session.AppendRows(req.Side, req.Columns, req.Rows, req.Done); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Message: a.appText("result_diff.backend.result.chunk_accepted", nil)}
}

// ResultDiffCompute 在两侧 upload 完成后计算 diff。
func (a *App) ResultDiffCompute(jobID string) connection.QueryResult {
	if a == nil || a.resultDiffManager == nil {
		return connection.QueryResult{Success: false, Message: defaultAppText("result_diff.backend.error.manager_unavailable", nil)}
	}
	session, err := a.resultDiffManager.Get(jobID)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	summary, err := session.Compute()
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{
		Success: true,
		Message: a.appText("result_diff.backend.result.ready", nil),
		Data:    resultdiff.StartResult{JobID: session.ID, Summary: summary},
	}
}

// ResultDiffPage 分页获取 diff 行。
func (a *App) ResultDiffPage(req resultdiff.PageRequest) connection.QueryResult {
	if a == nil || a.resultDiffManager == nil {
		return connection.QueryResult{Success: false, Message: defaultAppText("result_diff.backend.error.manager_unavailable", nil)}
	}
	session, err := a.resultDiffManager.Get(req.JobID)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	page, err := session.Page(req)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Data: page}
}

// ResultDiffClose 释放 diff 会话内存。
func (a *App) ResultDiffClose(jobID string) connection.QueryResult {
	if a == nil || a.resultDiffManager == nil {
		return connection.QueryResult{Success: false, Message: defaultAppText("result_diff.backend.error.manager_unavailable", nil)}
	}
	a.resultDiffManager.Close(jobID)
	return connection.QueryResult{Success: true, Message: a.appText("result_diff.backend.result.closed", nil)}
}

func (a *App) closeResultDiffSessions() int {
	if a == nil || a.resultDiffManager == nil {
		return 0
	}
	return a.resultDiffManager.Shutdown()
}

func normalizeDatasetMode(mode resultdiff.DatasetMode) resultdiff.DatasetMode {
	switch strings.ToLower(strings.TrimSpace(string(mode))) {
	case "sql":
		return resultdiff.DatasetModeSQL
	case "rows":
		return resultdiff.DatasetModeRows
	default:
		return ""
	}
}

func (a *App) loadResultDiffSQL(config connection.ConnectionConfig, database, sqlText string, maxRows int) ([]map[string]interface{}, []string, error) {
	sqlText = strings.TrimSpace(sqlText)
	if sqlText == "" {
		return nil, nil, fmt.Errorf("%s", a.appText("result_diff.backend.error.sql_required", nil))
	}
	if maxRows <= 0 {
		maxRows = resultdiff.DefaultMaxRowsPerSide
	}

	// 复用 DBQuery 路径（含只读校验、连接缓存）
	result := a.DBQuery(config, database, sqlText)
	if !result.Success {
		return nil, nil, fmt.Errorf("%s", result.Message)
	}

	rows, cols, err := extractQueryRows(result)
	if err != nil {
		return nil, nil, err
	}
	if len(rows) > maxRows {
		return nil, nil, fmt.Errorf("%s", a.appText("result_diff.backend.error.row_limit_exceeded", map[string]any{
			"count":   len(rows),
			"maxRows": maxRows,
		}))
	}
	return rows, cols, nil
}

func extractQueryRows(result connection.QueryResult) ([]map[string]interface{}, []string, error) {
	cols := result.Fields
	switch data := result.Data.(type) {
	case []map[string]interface{}:
		if len(cols) == 0 && len(data) > 0 {
			for k := range data[0] {
				cols = append(cols, k)
			}
		}
		return data, cols, nil
	case []interface{}:
		rows := make([]map[string]interface{}, 0, len(data))
		for _, item := range data {
			row, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			rows = append(rows, row)
		}
		if len(cols) == 0 && len(rows) > 0 {
			for k := range rows[0] {
				cols = append(cols, k)
			}
		}
		return rows, cols, nil
	case map[string]interface{}:
		// affectedRows 等非结果集
		if _, ok := data["affectedRows"]; ok {
			return nil, nil, fmt.Errorf("query did not return a result set")
		}
		return []map[string]interface{}{data}, cols, nil
	case nil:
		return []map[string]interface{}{}, cols, nil
	default:
		return nil, nil, fmt.Errorf("unsupported query result type %T", result.Data)
	}
}
