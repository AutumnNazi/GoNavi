package app

import (
	"context"
	"errors"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

func TestDBQueryMultiWithOptionsPassesNormalizedBudget(t *testing.T) {
	originalNewDatabaseFunc := newDatabaseFunc
	t.Cleanup(func() { newDatabaseFunc = originalNewDatabaseFunc })
	database := &mcpRowBudgetCaptureDatabase{sqlAuditTestDatabase: sqlAuditTestDatabase{
		rows:    []map[string]interface{}{{"id": int64(1)}},
		columns: []string{"id"},
	}}
	newDatabaseFunc = func(string) (db.Database, error) { return database, nil }
	application := newSQLAuditTestApp(t)
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, Database: "app"}
	options := QueryResultBudgetOptions{
		MaxRowsPerResult: 25,
		MaxTotalRows:     40,
		MaxTotalBytes:    4096,
		MaxFieldBytes:    1024,
	}

	result := application.DBQueryMultiWithOptions(config, "app", "SELECT id FROM users", "desktop-budget", options)
	if !result.Success {
		t.Fatalf("desktop query with budget failed: %s", result.Message)
	}
	if len(database.ctxs) != 1 {
		t.Fatalf("dispatched contexts = %d, want 1", len(database.ctxs))
	}
	budget := db.RowBudgetFromContext(database.ctxs[0])
	if budget == nil || budget.Options() != (db.RowBudgetOptions{
		MaxRowsPerResult: 25,
		MaxTotalRows:     40,
		MaxTotalBytes:    4096,
		MaxFieldBytes:    1024,
	}) {
		t.Fatalf("desktop query budget = %#v", budget)
	}
}

func TestDBQueryMultiWithOptionsPreservesQueryErrors(t *testing.T) {
	originalNewDatabaseFunc := newDatabaseFunc
	t.Cleanup(func() { newDatabaseFunc = originalNewDatabaseFunc })
	database := &mcpRowBudgetCaptureDatabase{sqlAuditTestDatabase: sqlAuditTestDatabase{
		queryErr: errors.New("scan failed"),
	}}
	newDatabaseFunc = func(string) (db.Database, error) { return database, nil }
	application := newSQLAuditTestApp(t)
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, Database: "app"}

	result := application.DBQueryMultiWithOptions(
		config,
		"app",
		"SELECT id FROM users",
		"desktop-budget-error",
		QueryResultBudgetOptions{MaxRowsPerResult: 10},
	)
	if result.Success || result.Message == "" {
		t.Fatalf("budgeted query error = %#v", result)
	}
	if len(database.ctxs) != 1 || db.RowBudgetFromContext(database.ctxs[0]) == nil {
		t.Fatalf("budgeted query error context = %#v", database.ctxs)
	}
}

func TestDBQueryMultiWithOptionsUsesSafeUnlimitedDefaults(t *testing.T) {
	normalized := normalizeQueryResultBudgetOptions(QueryResultBudgetOptions{})
	if normalized.MaxRowsPerResult != queryEditorSafeMaxRows ||
		normalized.MaxTotalRows != queryEditorSafeMaxRows ||
		normalized.MaxTotalBytes != queryEditorSafeMaxTotalBytes ||
		normalized.MaxFieldBytes != queryEditorSafeMaxFieldBytes {
		t.Fatalf("safe unlimited budget = %#v", normalized)
	}
}

// 负数哨兵是「显式不限」：归一化后必须是 0（internal/db 的行预算把全 <=0 视作
// 不建预算），而不是被夹回安全上限——这正是「不限」此前仍卡在 5 万行的原因。
func TestNormalizeQueryResultBudgetOptionsHonorsUnlimitedSentinel(t *testing.T) {
	normalized := normalizeQueryResultBudgetOptions(QueryResultBudgetOptions{
		MaxRowsPerResult: queryResultBudgetUnlimited,
		MaxTotalRows:     queryResultBudgetUnlimited,
		MaxTotalBytes:    queryResultBudgetUnlimited,
		MaxFieldBytes:    queryEditorSafeMaxFieldBytes,
	})
	if normalized.MaxRowsPerResult != 0 ||
		normalized.MaxTotalRows != 0 ||
		normalized.MaxTotalBytes != 0 {
		t.Fatalf("unlimited budget should drop the row and byte caps, got %#v", normalized)
	}
	// 单字段上限必须保留：它是唯一还能兜住单格内存的闸门，也是 Oracle 文本
	// 大对象不退化成 4KiB 预览的前提。
	if normalized.MaxFieldBytes != queryEditorSafeMaxFieldBytes {
		t.Fatalf("per-field cap must survive the unlimited option, got %d", normalized.MaxFieldBytes)
	}
}

// 缺省（0）与显式不限（负数）必须区分开：外部调用方漏传字段时不能静默变成无上限。
func TestNormalizeQueryResultBudgetOptionsKeepsDefaultsDistinctFromUnlimited(t *testing.T) {
	omitted := normalizeQueryResultBudgetOptions(QueryResultBudgetOptions{MaxFieldBytes: queryEditorSafeMaxFieldBytes})
	unlimited := normalizeQueryResultBudgetOptions(QueryResultBudgetOptions{
		MaxRowsPerResult: queryResultBudgetUnlimited,
		MaxFieldBytes:    queryEditorSafeMaxFieldBytes,
	})
	if omitted.MaxRowsPerResult != queryEditorSafeMaxRows {
		t.Fatalf("omitted rows should fall back to the safe cap, got %d", omitted.MaxRowsPerResult)
	}
	if unlimited.MaxRowsPerResult != 0 {
		t.Fatalf("explicit unlimited rows should become 0, got %d", unlimited.MaxRowsPerResult)
	}
	// 总行数继承已归一化的每结果集上限，避免出现两种都不像的中间值。
	if omitted.MaxTotalRows != queryEditorSafeMaxRows || unlimited.MaxTotalRows != 0 {
		t.Fatalf("total rows should follow per-result rows: omitted=%d unlimited=%d", omitted.MaxTotalRows, unlimited.MaxTotalRows)
	}
}

// 超上限的正数仍要夹紧到安全值，否则「不限」放开的同日会顺带放开任意大值。
func TestNormalizeQueryResultBudgetOptionsStillClampsOversizedValues(t *testing.T) {
	normalized := normalizeQueryResultBudgetOptions(QueryResultBudgetOptions{
		MaxRowsPerResult: queryEditorSafeMaxRows + 1,
		MaxTotalRows:     queryEditorSafeMaxRows + 1,
		MaxTotalBytes:    queryEditorSafeMaxTotalBytes + 1,
		MaxFieldBytes:    queryEditorSafeMaxFieldBytes + 1,
	})
	if normalized.MaxRowsPerResult != queryEditorSafeMaxRows ||
		normalized.MaxTotalRows != queryEditorSafeMaxRows ||
		normalized.MaxTotalBytes != queryEditorSafeMaxTotalBytes ||
		normalized.MaxFieldBytes != queryEditorSafeMaxFieldBytes {
		t.Fatalf("oversized budget should clamp to the safe caps, got %#v", normalized)
	}
}

func TestWebRPCDBQueryMultiWithOptionsPassesRequestContext(t *testing.T) {
	originalNewDatabaseFunc := newDatabaseFunc
	t.Cleanup(func() { newDatabaseFunc = originalNewDatabaseFunc })
	database := &mcpRowBudgetCaptureDatabase{sqlAuditTestDatabase: sqlAuditTestDatabase{
		rows:    []map[string]interface{}{{"id": int64(1)}},
		columns: []string{"id"},
	}}
	newDatabaseFunc = func(string) (db.Database, error) { return database, nil }
	application := newSQLAuditTestApp(t)
	config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, Database: "app"}
	handler, ok := WebRPCContextHandlers(application)["DBQueryMultiWithOptions"].(func(
		context.Context,
		connection.ConnectionConfig,
		string,
		string,
		string,
		QueryResultBudgetOptions,
	) connection.QueryResult)
	if !ok {
		t.Fatal("DBQueryMultiWithOptions Web RPC handler missing or has wrong signature")
	}

	type requestContextKey struct{}
	ctx, cancel := context.WithCancel(context.WithValue(context.Background(), requestContextKey{}, "web-budget"))
	defer cancel()
	result := handler(ctx, config, "app", "SELECT id FROM users", "web-budget", QueryResultBudgetOptions{MaxRowsPerResult: 10})
	if !result.Success || len(database.ctxs) != 1 || database.ctxs[0].Value(requestContextKey{}) != "web-budget" {
		t.Fatalf("request-scoped budget query = result=%#v contexts=%#v", result, database.ctxs)
	}
}

func TestManagedTransactionBudgetOptionsReachInitialAndFollowUpQueries(t *testing.T) {
	originalNewDatabaseFunc := newDatabaseFunc
	t.Cleanup(func() { newDatabaseFunc = originalNewDatabaseFunc })
	updateStmt := "UPDATE users SET name = 'new' WHERE id = 1"
	readStmt := "SELECT name FROM users WHERE id = 1"
	database := &fakeTransactionalDB{fakeBatchWriteDB: fakeBatchWriteDB{
		execAffected: map[string]int64{updateStmt: 1},
		queryMap:     map[string][]map[string]interface{}{readStmt: {{"name": "new"}}},
		fieldMap:     map[string][]string{readStmt: {"name"}},
	}}
	newDatabaseFunc = func(string) (db.Database, error) { return database, nil }
	application := newSQLAuditTestApp(t)
	config := connection.ConnectionConfig{Type: "mysql", Host: "127.0.0.1", Port: 3306, Database: "main"}
	options := QueryResultBudgetOptions{MaxRowsPerResult: 7, MaxTotalRows: 9, MaxTotalBytes: 2048, MaxFieldBytes: 256}

	started := application.DBQueryMultiTransactionalWithOptions(config, "main", updateStmt, "tx-budget-start", options)
	if !started.Success || database.txSession == nil {
		t.Fatalf("start budgeted transaction = %#v", started)
	}
	if budget := db.RowBudgetFromContext(database.lastCtx); budget == nil || budget.MaxRowsPerResult() != 7 {
		t.Fatalf("initial transaction context budget = %#v", budget)
	}
	read := application.DBQueryMultiInTransactionWithOptions(started.TransactionID, readStmt, "tx-budget-read", options)
	if !read.Success {
		t.Fatalf("budgeted transaction read = %#v", read)
	}
	if budget := db.RowBudgetFromContext(database.lastCtx); budget == nil || budget.MaxTotalRows() != 9 {
		t.Fatalf("follow-up transaction context budget = %#v", budget)
	}
	_ = application.DBRollbackTransaction(started.TransactionID)
}
