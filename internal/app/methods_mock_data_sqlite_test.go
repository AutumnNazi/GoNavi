//go:build gonavi_full_drivers || gonavi_sqlite_driver

package app

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/mockdata"
)

// TestMockDataEndToEndOnSQLite 用真实 SQLite 驱动跑完整链路：读结构 → 推荐规则 → 采样父表 → 批量写入 → 回查约束。
func TestMockDataEndToEndOnSQLite(t *testing.T) {
	client := &db.SQLiteDB{}
	path := filepath.Join(t.TempDir(), "mock.db")
	if err := client.Connect(connection.ConnectionConfig{Type: "sqlite", Host: path}); err != nil {
		t.Fatalf("connect sqlite: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })
	for _, statement := range []string{
		"PRAGMA foreign_keys = ON",
		"CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(20) NOT NULL)",
		"INSERT INTO users (name) VALUES ('a'), ('b'), ('c')",
		`CREATE TABLE orders (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			order_no VARCHAR(12) NOT NULL UNIQUE,
			user_id INTEGER NOT NULL REFERENCES users(id),
			email VARCHAR(40),
			amount DECIMAL(8,2) NOT NULL,
			is_paid BOOLEAN NOT NULL,
			created_at DATETIME NOT NULL,
			remark TEXT
		)`,
	} {
		if _, err := client.Exec(statement); err != nil {
			t.Fatalf("setup %q: %v", statement, err)
		}
	}

	columns, err := client.GetColumns("", "orders")
	if err != nil {
		t.Fatalf("GetColumns: %v", err)
	}
	indexes, _ := client.GetIndexes("", "orders")
	foreignKeys, _ := client.GetForeignKeys("", "orders")
	table := &mockDataTable{dbInst: client, dbType: "sqlite", family: mockdata.FamilySQLite, columns: columns}
	table.profiles = mockdata.ClassifyTable(table.family, columns, mockDataKeysFromMetadata(indexes, foreignKeys))
	app := &App{}
	app.fillMockDataLookups(context.Background(), table, "", "orders")
	if got := len(table.refs["user_id"]); got != 3 {
		t.Fatalf("user_id should sample 3 parent ids, got %d (fks=%v)", got, foreignKeys)
	}

	plan := mockdata.Plan{RowCount: 2500, Seed: 7, Locale: mockdata.LocaleZH, Columns: mockdata.SuggestPlans(table.profiles, mockdata.LocaleZH, mockDataTestNow())}
	producer, err := mockdata.NewProducer(plan, table.profiles, table.refs)
	if err != nil {
		t.Fatalf("NewProducer: %v (plans=%+v)", err, plan.Columns)
	}
	result := app.runMockDataWrite(context.Background(), table, "orders", producer, "job-sqlite", MockDataRunOptions{})
	if !result.Success {
		t.Fatalf("write failed: %+v", result)
	}

	expectCount := func(query string, want int) {
		t.Helper()
		values, err := queryFirstColumnTexts(context.Background(), client, query)
		if err != nil || len(values) != 1 || values[0] != fmt.Sprint(want) {
			t.Fatalf("%s = %v (err %v), want %d", query, values, err, want)
		}
	}
	expectCount("SELECT COUNT(*) FROM orders", 2500)
	expectCount("SELECT COUNT(DISTINCT order_no) FROM orders", 2500)
	expectCount("SELECT COUNT(*) FROM orders WHERE user_id NOT IN (SELECT id FROM users)", 0)
	expectCount("SELECT COUNT(*) FROM orders WHERE amount < 0 OR amount > 999999.99", 0)
	expectCount("SELECT COUNT(*) FROM orders WHERE length(order_no) > 12", 0)
}
