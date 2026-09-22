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
