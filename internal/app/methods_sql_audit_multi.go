package app

import (
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/sqlaudit"
)

// 保持逐条事件先于汇总事件落盘，并让失败路径共享同一个请求上下文。
func (a *App) beginSQLAuditMulti(input sqlAuditQueryInput, startedAt time.Time, result *connection.QueryResult, statements *[]sqlaudit.Event) func() {
	return func() {
		a.appendSQLAuditEvents(*statements)
		input.CommitMode = result.CommitMode
		input.Duration = time.Since(startedAt)
		input.Result = *result
		a.recordSQLAuditQuery(input)
	}
}
