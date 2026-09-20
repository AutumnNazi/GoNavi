package app

import (
	"strconv"
	"strings"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/logger"
)

// 执行前数据快照的接线层（P1：DataGrid 行编辑提交）。
//
// 与 methods_file.go 的分工：那里负责把变更写进数据库，这里只负责"写之前留一份可还原的线索"。
// 两者通过 connection.ChangeSet 上新增的可选字段通信 —— 不新增 RPC 参数，旧前端零改动。

// captureDMLSnapshot 在一次成功的数据变更之后记录执行前快照。
//
// 只在提交**成功**后调用：失败或结果未知时数据库状态本身就不确定，
// 此时生成"反向语句"会把不确定性伪装成可还原。
//
// 写入失败只记日志，绝不冒泡 —— 让一次成功的提交因为"存快照失败"而返回错误，
// 会诱导用户重试，造成二次写入。
func (a *App) captureDMLSnapshot(
	config connection.ConnectionConfig,
	dbName string,
	tableName string,
	changes connection.ChangeSet,
) {
	result := generateChangeReverseForConfig(config, tableName, changes)
	// 判据是"生成器实际产出了几条语句"，而不是"变更集里有没有 before-image"。
	// 二者并不等价：纯 INSERT 的变更集根本没有 before-image（行此前不存在），
	// 但只要行的定位值已知，反向 DELETE 就是精确的。按 before-image 判定会丢掉这类快照。
	//
	// 一条语句都没有时才不留记录 —— 避免快照中心堆满"点开才发现无法还原"的条目。
	if len(result.Deletes)+len(result.Updates)+len(result.Inserts) == 0 {
		return
	}

	entry := dmlSnapshotEntry{
		ID:         buildDMLSnapshotID(),
		CreatedAt:  time.Now().Format(time.RFC3339),
		Connection: strings.TrimSpace(config.ID),
		Driver:     strings.TrimSpace(config.Type),
		DBName:     strings.TrimSpace(dbName),
		Table:      strings.TrimSpace(tableName),
		Changes:    changes,
		Reverse:    result,
	}
	if err := newDMLSnapshotStore(a.configDir).Append(entry); err != nil {
		logger.Warnf("记录数据快照失败：%v table=%s", err, tableName)
	}
}

// generateChangeReverseForConfig 按方言生成反向语句。
//
// 与 buildChangePreview 走同一套引用与字面量格式化设施：转义只允许有一份实现，
// 转义写错会直接产出破坏性语句。
func generateChangeReverseForConfig(config connection.ConnectionConfig, tableName string, changes connection.ChangeSet) db.ChangeReverseResult {
	dbType := resolveDDLDBType(config)
	quoter := func(s string) string { return quoteIdentByType(dbType, s) }
	tableQuoter := func(s string) string { return quoteQualifiedIdentByType(dbType, s) }
	return db.GenerateChangeReverseWithDialect(tableName, changes, dbType, quoter, tableQuoter)
}

// buildDMLSnapshotID 生成快照 ID。
//
// 不用随机数：同一纳秒内的两次提交会撞号，而快照 ID 是前端定位条目的唯一键。
// 纳秒时间戳 + 进程内自增序列在单进程 Wails 后端下足够唯一，且无需引入依赖。
var dmlSnapshotSequence int64

func buildDMLSnapshotID() string {
	dmlSnapshotSequence++
	return time.Now().Format("20060102150405.000000000") + "-" + strconv.FormatInt(dmlSnapshotSequence, 10)
}

// DMLSnapshotSummary 快照中心列表项。
//
// 列表**不下发 Changes**（可能很大），只在详情接口里按 ID 取；
// 但必须下发 CannotFullyRestore 与 Skipped 计数，让列表阶段就能看出哪些条目不可完整还原。
type DMLSnapshotSummary struct {
	ID         string `json:"id"`
	CreatedAt  string `json:"createdAt"`
	Connection string `json:"connection,omitempty"`
	Driver     string `json:"driver,omitempty"`
	DBName     string `json:"dbName,omitempty"`
	Table      string `json:"table"`
	// CannotFullyRestore 为 true 表示该次变更**无法完整回滚**，UI 必须显式提示。
	CannotFullyRestore bool `json:"cannotFullyRestore"`
	SkippedCount       int  `json:"skippedCount"`
	StatementCount     int  `json:"statementCount"`
}

// ListDMLSnapshots 列出执行前快照（按时间倒序）。
//
// 只读接口：不涉及连接，因此不校验数据编辑权限，也不触碰任何数据库。
func (a *App) ListDMLSnapshots() connection.QueryResult {
	entries, err := newDMLSnapshotStore(a.configDir).List()
	if err != nil {
		logger.Warnf("读取数据快照列表失败：%v", err)
		return connection.QueryResult{
			Success: false,
			Message: a.appText("data_grid.backend.error.snapshot_list_failed", nil),
		}
	}

	summaries := make([]DMLSnapshotSummary, 0, len(entries))
	for _, entry := range entries {
		summaries = append(summaries, DMLSnapshotSummary{
			ID:                 entry.ID,
			CreatedAt:          entry.CreatedAt,
			Connection:         entry.Connection,
			Driver:             entry.Driver,
			DBName:             entry.DBName,
			Table:              entry.Table,
			CannotFullyRestore: !entry.Reverse.Complete,
			SkippedCount:       len(entry.Reverse.Skipped),
			StatementCount:     len(entry.Reverse.Deletes) + len(entry.Reverse.Updates) + len(entry.Reverse.Inserts),
		})
	}
	return connection.QueryResult{Success: true, Data: summaries}
}

// DMLSnapshotDetail 快照详情，含反向脚本与不可还原原因。
type DMLSnapshotDetail struct {
	DMLSnapshotSummary
	// Deletes / Updates / Inserts 为本快照对应的反向语句。
	// 回放顺序必须是 Deletes → Updates → Inserts：先撤销新增，再还原修改，最后补回删除。
	Deletes []string `json:"deletes"`
	Updates []string `json:"updates"`
	Inserts []string `json:"inserts"`
	// Skipped 逐条说明哪些行无法还原。非空即表示本次**不能完整回滚**。
	Skipped []db.SkippedReverseRow `json:"skipped,omitempty"`
}

// GetDMLSnapshot 按 ID 取快照详情。
func (a *App) GetDMLSnapshot(id string) connection.QueryResult {
	targetID := strings.TrimSpace(id)
	if targetID == "" {
		return connection.QueryResult{
			Success: false,
			Message: a.appText("data_grid.backend.error.snapshot_id_required", nil),
		}
	}

	entries, err := newDMLSnapshotStore(a.configDir).List()
	if err != nil {
		logger.Warnf("读取数据快照失败：%v", err)
		return connection.QueryResult{
			Success: false,
			Message: a.appText("data_grid.backend.error.snapshot_list_failed", nil),
		}
	}
	for _, entry := range entries {
		if entry.ID != targetID {
			continue
		}
		return connection.QueryResult{Success: true, Data: DMLSnapshotDetail{
			DMLSnapshotSummary: DMLSnapshotSummary{
				ID:                 entry.ID,
				CreatedAt:          entry.CreatedAt,
				Connection:         entry.Connection,
				Driver:             entry.Driver,
				DBName:             entry.DBName,
				Table:              entry.Table,
				CannotFullyRestore: !entry.Reverse.Complete,
				SkippedCount:       len(entry.Reverse.Skipped),
				StatementCount:     len(entry.Reverse.Deletes) + len(entry.Reverse.Updates) + len(entry.Reverse.Inserts),
			},
			Deletes: entry.Reverse.Deletes,
			Updates: entry.Reverse.Updates,
			Inserts: entry.Reverse.Inserts,
			Skipped: entry.Reverse.Skipped,
		}}
	}

	return connection.QueryResult{
		Success: false,
		Message: a.appText("data_grid.backend.error.snapshot_not_found", nil),
	}
}
