package app

import (
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/secretstore"
)

// SQL Server 的 GO 不能下发到服务端：原生多结果集与批量写这两条路径传的是用户原文，
// 必须因 GO 退回逐条执行（逐条下发的是拆分后的语句文本）。
func TestDBQueryMultiSQLServerGoBatchNeverReachesDriverAsRawText(t *testing.T) {
	installFakeOptionalDriverRuntime(t)
	originalNewDatabaseFunc := newDatabaseFunc
	t.Cleanup(func() {
		newDatabaseFunc = originalNewDatabaseFunc
	})

	query := "INSERT INTO demo(id) VALUES (1)\nGO\nINSERT INTO demo(id) VALUES (2)\nGO"
	baseDB := &fakeBatchWriteDB{
		queryErr:     map[string]error{},
		execAffected: map[string]int64{},
	}
	fakeDB := &fakeNativeMultiResultDB{fakeBatchWriteDB: baseDB}
	newDatabaseFunc = func(dbType string) (db.Database, error) {
		return fakeDB, nil
	}

	app := NewAppWithSecretStore(secretstore.NewUnavailableStore("test"))
	config := connection.ConnectionConfig{Type: "sqlserver", Host: "127.0.0.1", Port: 1433, User: "sa"}

	result := app.DBQueryMulti(config, "master", query, "sqlserver-go-batch-test")
	if !result.Success {
		t.Fatalf("expected DBQueryMulti success, got failure: %s", result.Message)
	}
	if fakeDB.multiCalls != 0 {
		t.Fatalf("native multi-result must not receive a GO batch, got %d calls", fakeDB.multiCalls)
	}
	if baseDB.execCalls != 2 {
		t.Fatalf("expected the GO batch to run statement by statement, got %d exec calls (%#v)", baseDB.execCalls, baseDB.execQueries)
	}
	for _, executed := range baseDB.execQueries {
		if strings.Contains(strings.ToUpper(executed), "GO") {
			t.Fatalf("GO reached the driver: %q", executed)
		}
	}
}

// 无 GO 时原生多结果集路径保持原样，不能被这次修复误伤。
func TestDBQueryMultiSQLServerWithoutGoKeepsNativeBatch(t *testing.T) {
	installFakeOptionalDriverRuntime(t)
	originalNewDatabaseFunc := newDatabaseFunc
	t.Cleanup(func() {
		newDatabaseFunc = originalNewDatabaseFunc
	})

	query := "SET STATISTICS IO, TIME ON;\nSELECT 1 AS value;"
	baseDB := &fakeBatchWriteDB{
		multiResult: map[string][]connection.ResultSetData{
			query: {{
				Rows:    []map[string]interface{}{{"value": 1}},
				Columns: []string{"value"},
			}},
		},
		queryErr: map[string]error{},
	}
	fakeDB := &fakeNativeMultiResultDB{fakeBatchWriteDB: baseDB}
	newDatabaseFunc = func(dbType string) (db.Database, error) {
		return fakeDB, nil
	}

	app := NewAppWithSecretStore(secretstore.NewUnavailableStore("test"))
	config := connection.ConnectionConfig{Type: "sqlserver", Host: "127.0.0.1", Port: 1433, User: "sa"}

	result := app.DBQueryMulti(config, "master", query, "sqlserver-native-batch-test")
	if !result.Success {
		t.Fatalf("expected DBQueryMulti success, got failure: %s", result.Message)
	}
	if fakeDB.multiCalls != 1 {
		t.Fatalf("expected the native multi-result batch to stay in use, got %d calls", fakeDB.multiCalls)
	}
}

// 批量写路径同样以原文下发，含 GO 时必须退回逐条执行。
func TestDBQueryMultiSQLServerSingleWriteWithGoSkipsBatchWrite(t *testing.T) {
	installFakeOptionalDriverRuntime(t)
	originalNewDatabaseFunc := newDatabaseFunc
	t.Cleanup(func() {
		newDatabaseFunc = originalNewDatabaseFunc
	})

	query := "INSERT INTO demo(id) VALUES (1)\nGO"
	baseDB := &fakeBatchWriteDB{
		queryErr:     map[string]error{},
		execAffected: map[string]int64{},
	}
	newDatabaseFunc = func(dbType string) (db.Database, error) {
		return baseDB, nil
	}

	app := NewAppWithSecretStore(secretstore.NewUnavailableStore("test"))
	config := connection.ConnectionConfig{Type: "sqlserver", Host: "127.0.0.1", Port: 1433, User: "sa"}

	result := app.DBQueryMulti(config, "master", query, "sqlserver-go-single-write-test")
	if !result.Success {
		t.Fatalf("expected DBQueryMulti success, got failure: %s", result.Message)
	}
	if baseDB.batchCalls != 0 {
		t.Fatalf("batch write must not receive a GO batch, got %d calls", baseDB.batchCalls)
	}
	if baseDB.execCalls != 1 {
		t.Fatalf("expected one statement-level exec, got %d", baseDB.execCalls)
	}
	if got := baseDB.execQueries[0]; strings.Contains(strings.ToUpper(got), "GO") {
		t.Fatalf("GO reached the driver: %q", got)
	}
}
