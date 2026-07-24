package app

import (
	"os"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	syncjob "GoNavi-Wails/internal/sync"
	"GoNavi-Wails/shared/i18n"
)

func TestConnectionReadOnlyMessagesUseLocalizedText(t *testing.T) {
	sourceBytes, err := os.ReadFile("connection_readonly.go")
	if err != nil {
		t.Fatalf("read connection_readonly.go: %v", err)
	}
	source := string(sourceBytes)

	rawMessages := []string{
		`return "当前连接已启用生产保护，仅允许执行查询操作"`,
		`return fmt.Sprintf("当前连接已启用生产保护，禁止执行%s", label)`,
	}
	for _, raw := range rawMessages {
		if strings.Contains(source, raw) {
			t.Fatalf("connection_readonly.go still contains raw user-visible text %q", raw)
		}
	}

	keys := []string{
		"query_editor.message.connection_readonly_blocked",
		"connection.backend.error.readonly_action_blocked",
		"connection.backend.action.create_database",
		"connection.backend.action.import_data",
		"connection.backend.action.data_sync_structure",
		"connection.backend.action.data_sync_write",
		"connection.backend.action.clear_table",
		"connection.backend.action.truncate_table",
	}
	for _, key := range keys {
		if !strings.Contains(source, key) {
			t.Fatalf("connection_readonly.go should reference localized key %q", key)
		}
	}
}

func TestConnectionReadOnlyCatalogKeysExist(t *testing.T) {
	catalogs, err := i18n.LoadCatalogs()
	if err != nil {
		t.Fatalf("LoadCatalogs() error = %v", err)
	}

	keys := []string{
		"connection.backend.error.readonly_action_blocked",
		"connection.backend.action.create_database",
		"connection.backend.action.create_schema",
		"connection.backend.action.rename_schema",
		"connection.backend.action.drop_schema",
		"connection.backend.action.rename_database",
		"connection.backend.action.drop_database",
		"connection.backend.action.rename_table",
		"connection.backend.action.copy_table",
		"connection.backend.action.drop_table",
		"connection.backend.action.drop_view",
		"connection.backend.action.drop_function_or_procedure",
		"connection.backend.action.rename_view",
		"connection.backend.action.import_data",
		"connection.backend.action.apply_result_changes",
		"connection.backend.action.preview_result_changes",
		"connection.backend.action.clear_table",
		"connection.backend.action.truncate_table",
		"connection.backend.action.data_sync_structure",
		"connection.backend.action.data_sync_write",
	}

	for _, language := range i18n.SupportedLanguages() {
		catalog := catalogs[language]
		for _, key := range keys {
			if strings.TrimSpace(catalog[key]) == "" {
				t.Fatalf("%s catalog missing connection read-only key %q", language, key)
			}
		}
	}
}

func TestConnectionReadOnlyUsesCurrentLanguageForBlockedMessages(t *testing.T) {
	app := NewApp()
	app.SetLanguage(string(i18n.LanguageEnUS))
	t.Cleanup(func() {
		app.SetLanguage(string(i18n.LanguageEnUS))
	})

	readonlyConfig := connection.ConnectionConfig{Type: "postgres", ReadOnly: true}

	createDatabase := app.CreateDatabase(readonlyConfig, "demo")
	expectedCreateDatabase := app.appText("connection.backend.error.readonly_action_blocked", map[string]any{
		"action": app.appText("connection.backend.action.create_database", nil),
	})
	if createDatabase.Message != expectedCreateDatabase {
		t.Fatalf("expected localized create-database message %q, got %q", expectedCreateDatabase, createDatabase.Message)
	}

	dataSync := app.DataSync(syncjob.SyncConfig{
		TargetConfig: readonlyConfig,
	})
	expectedDataSync := app.appText("connection.backend.error.readonly_action_blocked", map[string]any{
		"action": app.appText("connection.backend.action.data_sync_write", nil),
	})
	if dataSync.Message != expectedDataSync {
		t.Fatalf("expected localized data-sync message %q, got %q", expectedDataSync, dataSync.Message)
	}

	clearTable := app.runTableDataClear(readonlyConfig, "demo", []string{"users"}, tableDataClearModeDeleteAll)
	expectedClearTable := app.appText("connection.backend.error.readonly_action_blocked", map[string]any{
		"action": app.appText("connection.backend.action.clear_table", nil),
	})
	if clearTable.Message != expectedClearTable {
		t.Fatalf("expected localized clear-table message %q, got %q", expectedClearTable, clearTable.Message)
	}
	if strings.Contains(clearTable.Message, "clear_table") {
		t.Fatalf("expected no raw clear_table sentinel in blocked message, got %q", clearTable.Message)
	}

	blockedQuery := app.DBQueryMultiTransactional(readonlyConfig, "", "update users set active = 1", "q-readonly")
	expectedBlockedQuery := app.appText("query_editor.message.connection_readonly_blocked", nil)
	if blockedQuery.Message != expectedBlockedQuery {
		t.Fatalf("expected localized read-only query message %q, got %q", expectedBlockedQuery, blockedQuery.Message)
	}
	if strings.Contains(blockedQuery.Message, "当前连接已启用生产保护") {
		t.Fatalf("expected no raw Chinese query-blocked message, got %q", blockedQuery.Message)
	}
}
