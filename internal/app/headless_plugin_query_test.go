package app

import (
	"context"
	"testing"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/connection"
)

func TestHeadlessPluginQueryIgnoresAllowWrite(t *testing.T) {
	runtime, err := NewHeadlessRuntime(context.Background(), HeadlessRuntimeOptions{DataRoot: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	saveHeadlessSafetyLevel(t, runtime, ai.PermissionFull)
	database := &headlessSecretCaptureDB{sqlAuditTestDatabase: sqlAuditTestDatabase{rows: []map[string]interface{}{{"ok": 1}}, columns: []string{"ok"}}}
	installHeadlessTestDatabase(t, database)
	config := connection.ConnectionConfig{Type: "plugin:example.reader:source:postgres", ReadOnly: false}
	write := runtime.Query(context.Background(), config, "app", "DELETE FROM demo", HeadlessQueryOptions{AllowMutating: true})
	if write.Success || database.connected {
		t.Fatalf("allow-write reached a plugin data source: success=%t connected=%t message=%s", write.Success, database.connected, write.Message)
	}
}

func TestHeadlessPluginBatchIgnoresAllowWrite(t *testing.T) {
	runtime, err := NewHeadlessRuntime(context.Background(), HeadlessRuntimeOptions{DataRoot: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	saveHeadlessSafetyLevel(t, runtime, ai.PermissionFull)
	database := &headlessSecretCaptureDB{sqlAuditTestDatabase: sqlAuditTestDatabase{rows: []map[string]interface{}{{"ok": 1}}, columns: []string{"ok"}}}
	installHeadlessTestDatabase(t, database)
	config := connection.ConnectionConfig{Type: "plugin:example.reader:source:postgres", ReadOnly: false}
	result := runtime.ExecuteSQLFile(context.Background(), config, "app", "missing.sql", HeadlessSQLFileOptions{AllowMutating: true})
	if result.Success || database.connected {
		t.Fatalf("batch allow-write reached a plugin data source: success=%t connected=%t message=%s", result.Success, database.connected, result.Message)
	}
}
