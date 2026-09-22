//go:build gonavi_full_drivers || gonavi_sqlite_driver

package app

import (
	"path/filepath"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestDBQueryMultiWithOptionsTruncatesExistingLimitAtScanLayer(t *testing.T) {
	application := newSQLAuditTestApp(t)
	databasePath := filepath.Join(t.TempDir(), "query-budget.sqlite")
	config := connection.ConnectionConfig{
		Type: "custom", Driver: "sqlite", DSN: databasePath, Database: databasePath,
	}
	t.Cleanup(func() { application.DBReleaseConnection(config) })

	result := application.DBQueryMultiWithOptions(
		config,
		databasePath,
		`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 100) SELECT n FROM seq LIMIT 100`,
		"sqlite-budget-existing-limit",
		QueryResultBudgetOptions{MaxRowsPerResult: 10, MaxTotalRows: 10},
	)
	if !result.Success {
		t.Fatalf("budgeted SQLite query failed: %s", result.Message)
	}
	resultSets, ok := result.Data.([]connection.ResultSetData)
	if !ok || len(resultSets) != 1 || len(resultSets[0].Rows) != 10 || !resultSets[0].Truncated {
		t.Fatalf("budgeted SQLite result = %T %#v", result.Data, result.Data)
	}
}

func TestDBQueryMultiWithOptionsTruncatesReturningRows(t *testing.T) {
	application := newSQLAuditTestApp(t)
	databasePath := filepath.Join(t.TempDir(), "query-budget-returning.sqlite")
	config := connection.ConnectionConfig{
		Type: "custom", Driver: "sqlite", DSN: databasePath, Database: databasePath,
	}
	t.Cleanup(func() { application.DBReleaseConnection(config) })
	created := application.DBQueryMulti(config, databasePath, "CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)", "sqlite-budget-create")
	if !created.Success {
		t.Fatalf("create budget test table: %s", created.Message)
	}

	result := application.DBQueryMultiWithOptions(
		config,
		databasePath,
		"INSERT INTO items(value) VALUES ('1'),('2'),('3'),('4'),('5'),('6'),('7'),('8') RETURNING id",
		"sqlite-budget-returning",
		QueryResultBudgetOptions{MaxRowsPerResult: 5, MaxTotalRows: 5},
	)
	if !result.Success {
		t.Fatalf("budgeted SQLite RETURNING failed: %#v", result)
	}
	resultSets, ok := result.Data.([]connection.ResultSetData)
	if !ok || len(resultSets) != 1 || len(resultSets[0].Rows) != 5 || !resultSets[0].Truncated {
		t.Fatalf("budgeted SQLite RETURNING result = %T %#v", result.Data, result.Data)
	}
}
