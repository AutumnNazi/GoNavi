package app

import (
	"encoding/json"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestWritablePluginDataSourceManagedTransaction(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	a, config := installHostDataSourceExample(t, buildHostDataSourcePackage(t, "writable-database"))
	config.PluginWritable = true
	config.ReadOnly = false
	config.Protection = connection.ConnectionProtectionConfig{}
	if result := a.DBConnect(config); !result.Success {
		t.Fatalf("connect: %+v", result)
	}
	started := a.DBQueryMultiTransactional(config, "fixture", "UPDATE people SET name = 'Committed' WHERE id = 2", "plugin-tx-commit")
	if !started.Success || started.TransactionID == "" {
		t.Fatalf("begin writable plugin transaction: %+v", started)
	}
	if result := a.DBCommitTransaction(started.TransactionID); !result.Success {
		t.Fatalf("commit: %+v", result)
	}
	if rows := queryPluginNames(t, a, config); !strings.Contains(rows, "Committed") {
		t.Fatalf("commit did not persist: %s", rows)
	}
	started = a.DBQueryMultiTransactional(config, "fixture", "UPDATE people SET name = 'RolledBack' WHERE id = 2", "plugin-tx-rollback")
	if !started.Success || started.TransactionID == "" {
		t.Fatalf("begin rollback transaction: %+v", started)
	}
	if result := a.DBRollbackTransaction(started.TransactionID); !result.Success {
		t.Fatalf("rollback: %+v", result)
	}
	if rows := queryPluginNames(t, a, config); strings.Contains(rows, "RolledBack") || !strings.Contains(rows, "Committed") {
		t.Fatalf("rollback changed committed state: %s", rows)
	}
}

func TestWritablePluginDataSourceDirectQueryStaysReadOnlyWithoutOptIn(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	a, config := installHostDataSourceExample(t, buildHostDataSourcePackage(t, "writable-database"))
	database, err := a.getDatabase(config)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := database.Query("UPDATE people SET name = 'Bypass' WHERE id = 2"); err == nil {
		t.Fatal("unopted writable source accepted a mutating query")
	}
	if _, _, err := database.Query("SELECT * FROM people"); err != nil {
		t.Fatalf("unopted writable source rejected a read-only query: %v", err)
	}
}

func queryPluginNames(t *testing.T, a *App, config connection.ConnectionConfig) string {
	t.Helper()
	result := a.DBQuery(config, "fixture", "SELECT * FROM people")
	if !result.Success {
		t.Fatalf("query: %+v", result)
	}
	raw, err := json.Marshal(result.Data)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
