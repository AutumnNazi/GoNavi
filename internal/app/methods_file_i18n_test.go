package app

import (
	"os"
	"strings"
	"testing"

	"GoNavi-Wails/shared/i18n"
)

func methodsFileFunctionSource(t *testing.T, source string, signature string) string {
	t.Helper()
	start := strings.Index(source, signature)
	if start < 0 {
		t.Fatalf("methods_file.go missing function signature %q", signature)
	}
	rest := source[start+len(signature):]
	end := strings.Index(rest, "\nfunc ")
	if end < 0 {
		return source[start:]
	}
	return source[start : start+len(signature)+end]
}

func TestMethodsFileSelectorsUseLocalizedDialogText(t *testing.T) {
	sourceBytes, err := os.ReadFile("methods_file.go")
	if err != nil {
		t.Fatalf("read methods_file.go: %v", err)
	}
	source := string(sourceBytes)

	for _, literal := range []string{
		"\u9009\u62e9 SSH \u79c1\u94a5\u6587\u4ef6",
		"\u79c1\u94a5\u6587\u4ef6",
		"\u6240\u6709\u6587\u4ef6",
		"\u9009\u62e9 TLS \u8bc1\u4e66\u6587\u4ef6",
		"\u8bc1\u4e66\u6587\u4ef6",
		"\u9009\u62e9 CA/\u670d\u52a1\u7aef\u8bc1\u4e66\u6587\u4ef6",
		"\u9009\u62e9\u5ba2\u6237\u7aef\u8bc1\u4e66\u6587\u4ef6",
		"\u9009\u62e9\u5ba2\u6237\u7aef\u79c1\u94a5\u6587\u4ef6",
		"\u6570\u636e\u5e93\u6587\u4ef6",
		"\u9009\u62e9\u6570\u636e\u5e93\u6587\u4ef6",
		"\u9009\u62e9 SQLite \u6570\u636e\u6587\u4ef6",
		"SQLite \u6587\u4ef6",
		"\u9009\u62e9 DuckDB \u6570\u636e\u6587\u4ef6",
		"DuckDB \u6587\u4ef6",
	} {
		if strings.Contains(source, literal) {
			t.Fatalf("methods_file.go still contains raw dialog text %q", literal)
		}
	}
}

func TestExternalSQLFileBackendMessagesUseLocalizedText(t *testing.T) {
	sourceBytes, err := os.ReadFile("methods_file.go")
	if err != nil {
		t.Fatalf("read methods_file.go: %v", err)
	}
	source := string(sourceBytes)

	checks := map[string][]string{
		"func normalizeSQLFileName": {
			"\u0053\u0051\u004c \u6587\u4ef6\u540d\u4e0d\u80fd\u4e3a\u7a7a",
			"\u0053\u0051\u004c \u6587\u4ef6\u540d\u4e0d\u80fd\u5305\u542b\u8def\u5f84\u5206\u9694\u7b26",
		},
		"func normalizeSQLDirectoryName": {
			"\u76ee\u5f55\u540d\u4e0d\u80fd\u4e3a\u7a7a",
			"\u76ee\u5f55\u540d\u4e0d\u80fd\u5305\u542b\u8def\u5f84\u5206\u9694\u7b26",
		},
		"func normalizeSQLDirectoryPath": {
			"\u76ee\u5f55\u8def\u5f84\u4e0d\u80fd\u4e3a\u7a7a",
			"\u65e0\u6cd5\u8bfb\u53d6\u76ee\u5f55\u4fe1\u606f:",
			"\u6240\u9009\u8def\u5f84\u4e0d\u662f\u76ee\u5f55",
		},
		"func normalizeExistingSQLDirectoryPath": {
			"\u76ee\u5f55\u8def\u5f84\u4e0d\u80fd\u4e3a\u7a7a",
			"\u65e0\u6cd5\u8bfb\u53d6\u76ee\u5f55\u4fe1\u606f:",
			"\u6240\u9009\u8def\u5f84\u4e0d\u662f\u76ee\u5f55",
		},
		"func normalizeExistingSQLFilePath": {
			"\u6587\u4ef6\u8def\u5f84\u4e0d\u80fd\u4e3a\u7a7a",
			"\u65e0\u6cd5\u8bfb\u53d6\u6587\u4ef6\u4fe1\u606f:",
			"\u6240\u9009\u8def\u5f84\u4e0d\u662f SQL \u6587\u4ef6",
			"\u4ec5\u652f\u6301 SQL \u6587\u4ef6",
		},
		"func createSQLFileInDirectory": {
			"\u0053\u0051\u004c \u6587\u4ef6\u5df2\u5b58\u5728",
			"\u65e0\u6cd5\u8bfb\u53d6\u6587\u4ef6\u4fe1\u606f:",
			"\u65e0\u6cd5\u521b\u5efa SQL \u6587\u4ef6:",
		},
		"func createSQLDirectoryInDirectory": {
			"\u76ee\u5f55\u5df2\u5b58\u5728",
			"\u65e0\u6cd5\u8bfb\u53d6\u76ee\u5f55\u4fe1\u606f:",
			"\u65e0\u6cd5\u521b\u5efa\u76ee\u5f55:",
		},
		"func deleteSQLFileByPath": {
			"\u65e0\u6cd5\u5220\u9664 SQL \u6587\u4ef6:",
		},
		"func deleteSQLDirectoryByPath": {
			"\u65e0\u6cd5\u5220\u9664\u76ee\u5f55:",
			"\u4ec5\u652f\u6301\u5220\u9664\u7a7a\u76ee\u5f55",
		},
		"func renameSQLFileByPath": {
			"\u76ee\u6807 SQL \u6587\u4ef6\u5df2\u5b58\u5728",
			"\u65e0\u6cd5\u8bfb\u53d6\u76ee\u6807\u6587\u4ef6\u4fe1\u606f:",
			"\u65e0\u6cd5\u91cd\u547d\u540d SQL \u6587\u4ef6:",
		},
		"func renameSQLDirectoryByPath": {
			"\u76ee\u6807\u76ee\u5f55\u5df2\u5b58\u5728",
			"\u65e0\u6cd5\u8bfb\u53d6\u76ee\u6807\u76ee\u5f55\u4fe1\u606f:",
			"\u65e0\u6cd5\u91cd\u547d\u540d\u76ee\u5f55:",
		},
		"func readSQLFileByPath": {
			"\u6587\u4ef6\u8def\u5f84\u4e0d\u80fd\u4e3a\u7a7a",
			"\u65e0\u6cd5\u8bfb\u53d6\u6587\u4ef6\u4fe1\u606f:",
			"\u6240\u9009\u8def\u5f84\u4e0d\u662f SQL \u6587\u4ef6",
		},
		"func writeSQLFileByPath": {
			"\u6587\u4ef6\u8def\u5f84\u4e0d\u80fd\u4e3a\u7a7a",
			"\u65e0\u6cd5\u8bfb\u53d6\u6587\u4ef6\u4fe1\u606f:",
			"\u6240\u9009\u8def\u5f84\u4e0d\u662f SQL \u6587\u4ef6",
			"\u65e0\u6cd5\u5199\u5165 SQL \u6587\u4ef6:",
		},
		"func writeExportedSQLFileByPath": {
			"\u6587\u4ef6\u8def\u5f84\u4e0d\u80fd\u4e3a\u7a7a",
			"\u6240\u9009\u8def\u5f84\u4e0d\u662f SQL \u6587\u4ef6",
			"\u65e0\u6cd5\u8bfb\u53d6\u6587\u4ef6\u4fe1\u606f:",
			"\u65e0\u6cd5\u5199\u5165 SQL \u6587\u4ef6:",
		},
		"func (a *App) OpenSQLFile": {
			"Select SQL File",
			"SQL Files (*.sql)",
			"All Files (*.*)",
		},
		"func (a *App) SelectSQLDirectory": {
			"\u9009\u62e9 SQL \u76ee\u5f55",
		},
		"func (a *App) ListSQLDirectory": {
			"\u76ee\u5f55\u8def\u5f84\u4e0d\u80fd\u4e3a\u7a7a",
			"\u6240\u9009\u8def\u5f84\u4e0d\u662f\u76ee\u5f55",
		},
		"func (a *App) ExportSQLFile": {
			"\u5bfc\u51fa SQL \u6587\u4ef6",
			"SQL Files (*.sql)",
			"All Files (*.*)",
			"SQL \u6587\u4ef6\u5df2\u5bfc\u51fa",
		},
	}

	for signature, literals := range checks {
		functionSource := methodsFileFunctionSource(t, source, signature)
		for _, literal := range literals {
			if strings.Contains(functionSource, literal) {
				t.Fatalf("%s still contains raw external SQL file text %q", signature, literal)
			}
		}
	}
}

func TestImportConfigFileAllowsNavicatNCXSelection(t *testing.T) {
	sourceBytes, err := os.ReadFile("methods_file.go")
	if err != nil {
		t.Fatalf("read methods_file.go: %v", err)
	}
	source := methodsFileFunctionSource(t, string(sourceBytes), "func (a *App) ImportConfigFile() connection.QueryResult")

	for _, want := range []string{
		"Navicat Connections (*.ncx)",
		`Pattern:     "*.ncx"`,
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("ImportConfigFile missing Navicat NCX selector %q", want)
		}
	}
}

func TestExternalSQLFileBackendCatalogKeysExist(t *testing.T) {
	catalogs, err := i18n.LoadCatalogs()
	if err != nil {
		t.Fatalf("LoadCatalogs() error = %v", err)
	}

	keys := []string{
		"file.backend.dialog.select_sql_directory",
		"file.backend.dialog.select_sql_file",
		"file.backend.error.create_directory_failed",
		"file.backend.error.create_sql_file_failed",
		"file.backend.error.delete_sql_directory_failed",
		"file.backend.error.delete_sql_file_failed",
		"file.backend.error.directory_exists",
		"file.backend.error.directory_name_no_separator",
		"file.backend.error.directory_name_required",
		"file.backend.error.directory_path_required",
		"file.backend.error.file_path_required",
		"file.backend.error.read_directory_info_failed",
		"file.backend.error.read_file_info_failed",
		"file.backend.error.read_target_directory_info_failed",
		"file.backend.error.read_target_file_info_failed",
		"file.backend.error.rename_directory_failed",
		"file.backend.error.rename_sql_file_failed",
		"file.backend.error.selected_path_not_directory",
		"file.backend.error.selected_path_not_sql_file",
		"file.backend.error.sql_file_exists",
		"file.backend.error.sql_file_extension_required",
		"file.backend.error.sql_file_name_no_separator",
		"file.backend.error.sql_file_name_required",
		"file.backend.error.target_directory_exists",
		"file.backend.error.target_file_overwrite_confirmation_required",
		"file.backend.error.target_sql_file_exists",
		"file.backend.error.write_failed",
		"file.backend.filter.all_files_pattern",
		"file.backend.filter.sql_files",
		"query_editor.action.export_sql_file",
		"query_editor.message.export_sql_file_success",
	}
	for _, language := range i18n.SupportedLanguages() {
		catalog := catalogs[language]
		for _, key := range keys {
			if strings.TrimSpace(catalog[key]) == "" {
				t.Fatalf("%s catalog missing external SQL file key %q", language, key)
			}
		}
	}
}

func TestExportDriverAgentGuardUsesLocalizedText(t *testing.T) {
	sourceBytes, err := os.ReadFile("methods_file.go")
	if err != nil {
		t.Fatalf("read methods_file.go: %v", err)
	}
	source := string(sourceBytes)

	functionSource := methodsFileFunctionSource(t, source, "func verifyOptionalDriverAgentReadyForExport(config connection.ConnectionConfig) error {")
	rawLiteral := `fmt.Errorf("当前导出依赖最新的 %s driver-agent 流式协议；为避免大结果集回退到高内存缓冲模式，请在驱动管理中重装后重试：%w", displayName, err)`
	if strings.Contains(functionSource, rawLiteral) {
		t.Fatalf("verifyOptionalDriverAgentReadyForExport still contains raw export driver-agent guard text %q", rawLiteral)
	}
	if !strings.Contains(functionSource, "file.backend.error.export_driver_agent_streaming_required") {
		t.Fatal("verifyOptionalDriverAgentReadyForExport does not reference export driver-agent streaming i18n key")
	}
}

func TestExportDriverAgentGuardCatalogKeyExists(t *testing.T) {
	catalogs, err := i18n.LoadCatalogs()
	if err != nil {
		t.Fatalf("LoadCatalogs() error = %v", err)
	}

	for _, language := range i18n.SupportedLanguages() {
		catalog := catalogs[language]
		if strings.TrimSpace(catalog["file.backend.error.export_driver_agent_streaming_required"]) == "" {
			t.Fatalf("%s catalog missing export driver-agent streaming key", language)
		}
	}
}

func TestFileSelectorDialogCatalogKeysExist(t *testing.T) {
	catalogs, err := i18n.LoadCatalogs()
	if err != nil {
		t.Fatalf("LoadCatalogs() error = %v", err)
	}

	keys := []string{
		"file.backend.dialog.select_ssh_key_file",
		"file.backend.dialog.select_tls_certificate_file",
		"file.backend.dialog.select_ca_server_certificate_file",
		"file.backend.dialog.select_client_certificate_file",
		"file.backend.dialog.select_client_private_key_file",
		"file.backend.dialog.select_database_file",
		"file.backend.dialog.select_sqlite_file",
		"file.backend.dialog.select_duckdb_file",
		"file.backend.filter.private_key_files",
		"file.backend.filter.certificate_files",
		"file.backend.filter.database_files",
		"file.backend.filter.sqlite_files",
		"file.backend.filter.duckdb_files",
		"file.backend.filter.all_files",
	}
	for _, language := range i18n.SupportedLanguages() {
		catalog := catalogs[language]
		for _, key := range keys {
			if strings.TrimSpace(catalog[key]) == "" {
				t.Fatalf("%s catalog missing file selector key %q", language, key)
			}
		}
	}
}

func TestImportDataBackendMessagesUseLocalizedText(t *testing.T) {
	sourceBytes, err := os.ReadFile("methods_file.go")
	if err != nil {
		t.Fatalf("read methods_file.go: %v", err)
	}
	source := string(sourceBytes)

	checks := map[string][]string{
		"func (a *App) PreviewImportFile": {
			"\u6587\u4ef6\u8def\u5f84\u4e0d\u80fd\u4e3a\u7a7a",
		},
		"func (a *App) ImportData": {
			"Import into %s",
			"Data Files",
		},
		"func parseImportFileWithText": {
			"JSON Parse Error:",
			"CSV Parse Error:",
			"CSV empty or missing header",
			"Excel Parse Error:",
			"Excel file has no sheets",
			"Excel Read Error:",
			"Excel empty or missing header",
			"Unsupported file format",
		},
		"func (a *App) ImportDataWithProgress": {
			"\u65e0\u53ef\u5bfc\u5165\u6570\u636e",
			"Row %d:",
			"Imported: %d, Failed: %d",
		},
	}

	for signature, literals := range checks {
		functionSource := methodsFileFunctionSource(t, source, signature)
		for _, literal := range literals {
			if strings.Contains(functionSource, literal) {
				t.Fatalf("%s still contains raw import data text %q", signature, literal)
			}
		}
	}
}

func TestImportDataBackendCatalogKeysExist(t *testing.T) {
	catalogs, err := i18n.LoadCatalogs()
	if err != nil {
		t.Fatalf("LoadCatalogs() error = %v", err)
	}

	keys := []string{
		"file.backend.dialog.import_data",
		"file.backend.error.import_csv_empty_or_missing_header",
		"file.backend.error.import_csv_open_failed",
		"file.backend.error.import_csv_read_failed",
		"file.backend.error.import_excel_empty_or_missing_header",
		"file.backend.error.import_excel_no_sheets",
		"file.backend.error.import_excel_parse_failed",
		"file.backend.error.import_excel_read_failed",
		"file.backend.error.import_file_empty",
		"file.backend.error.import_job_already_running",
		"file.backend.error.import_json_parse_failed",
		"file.backend.error.import_unsupported_format",
		"file.backend.filter.data_files",
		"file.backend.message.import_cancelled",
		"file.backend.message.import_no_data",
		"file.backend.message.import_row_failed",
		"file.backend.message.import_summary",
	}
	for _, language := range i18n.SupportedLanguages() {
		catalog := catalogs[language]
		for _, key := range keys {
			if strings.TrimSpace(catalog[key]) == "" {
				t.Fatalf("%s catalog missing import data key %q", language, key)
			}
		}
	}
}

func TestApplyChangesMessagesUseLocalizedText(t *testing.T) {
	sourceBytes, err := os.ReadFile("methods_file.go")
	if err != nil {
		t.Fatalf("read methods_file.go: %v", err)
	}
	source := string(sourceBytes)
	functionSource := methodsFileFunctionSource(t, source, "func (a *App) ApplyChanges")

	for _, literal := range []string{
		"\u4e8b\u52a1\u63d0\u4ea4\u6210\u529f",
		"\u5f53\u524d\u6570\u636e\u5e93\u7c7b\u578b\u4e0d\u652f\u6301\u6279\u91cf\u63d0\u4ea4",
	} {
		if strings.Contains(functionSource, literal) {
			t.Fatalf("ApplyChanges still contains raw table edit commit text %q", literal)
		}
	}
}

func TestApplyChangesCatalogKeysExist(t *testing.T) {
	catalogs, err := i18n.LoadCatalogs()
	if err != nil {
		t.Fatalf("LoadCatalogs() error = %v", err)
	}

	keys := []string{
		"file.backend.error.batch_commit_unsupported",
		"file.backend.message.transaction_committed",
	}
	for _, language := range i18n.SupportedLanguages() {
		catalog := catalogs[language]
		for _, key := range keys {
			if strings.TrimSpace(catalog[key]) == "" {
				t.Fatalf("%s catalog missing table edit commit key %q", language, key)
			}
		}
	}
}

func TestTableDataClearMessagesUseLocalizedText(t *testing.T) {
	sourceBytes, err := os.ReadFile("methods_file.go")
	if err != nil {
		t.Fatalf("read methods_file.go: %v", err)
	}
	source := string(sourceBytes)

	checks := map[string][]string{
		"func buildTableDataClearSQLWithText": {
			"\u5f53\u524d\u6570\u636e\u5e93\u7c7b\u578b",
			"\u4e0d\u652f\u6301\u622a\u65ad\u8868",
			"\u4e0d\u652f\u6301\u7684\u8868\u6570\u636e\u6e05\u7406\u6a21\u5f0f",
		},
		"func tableDataClearActionLabels": {
			"\u622a\u65ad\u8868",
			"\u622a\u65ad",
			"\u6e05\u7a7a\u8868",
			"\u6e05\u7a7a",
		},
		"func (a *App) runTableDataClear": {
			"\u672a\u6307\u5b9a\u8981\u5904\u7406\u7684\u8868",
			"\u5355\u6b21\u6700\u591a\u5904\u7406",
			"\u5f20\u8868\uff0c\u5f53\u524d\u9009\u4e2d",
			"\u5931\u8d25:",
			"\uff08\u6ce8\u610f\uff1a\u524d ",
			"\u4e14\u65e0\u6cd5\u6062\u590d",
			"\"\u6210\u529f\"",
		},
	}

	for signature, literals := range checks {
		functionSource := methodsFileFunctionSource(t, source, signature)
		for _, literal := range literals {
			if strings.Contains(functionSource, literal) {
				t.Fatalf("%s still contains raw table data clear text %q", signature, literal)
			}
		}
	}
}

func TestTableDataClearCatalogKeysExist(t *testing.T) {
	catalogs, err := i18n.LoadCatalogs()
	if err != nil {
		t.Fatalf("LoadCatalogs() error = %v", err)
	}

	keys := []string{
		"file.backend.error.table_data_batch_limit",
		"file.backend.error.table_data_clear_failed",
		"file.backend.error.table_data_clear_failed_partial",
		"file.backend.error.table_data_mode_unsupported",
		"file.backend.error.table_data_no_tables",
		"file.backend.error.table_data_truncate_failed",
		"file.backend.error.table_data_truncate_failed_partial",
		"file.backend.error.table_data_truncate_unsupported",
		"file.backend.message.table_data_clear_succeeded",
		"file.backend.message.table_data_truncate_succeeded",
	}
	for _, language := range i18n.SupportedLanguages() {
		catalog := catalogs[language]
		for _, key := range keys {
			if strings.TrimSpace(catalog[key]) == "" {
				t.Fatalf("%s catalog missing table data clear key %q", language, key)
			}
		}
	}
}

func TestExportBackendMessagesUseLocalizedText(t *testing.T) {
	sourceBytes, err := os.ReadFile("methods_file.go")
	if err != nil {
		t.Fatalf("read methods_file.go: %v", err)
	}
	source := string(sourceBytes)

	checks := map[string][]string{
		"func (a *App) ExportConnectionsPackage": {
			"Export Connections",
			"\u5bfc\u51fa\u5b8c\u6210",
		},
		"func (a *App) ExportTable": {
			"Export %s",
			"\u5bfc\u51fa\u5b8c\u6210",
			"Message: \"\u5199\u5165\u5931\u8d25\uff1a",
			"\u6b63\u5728\u51c6\u5907\u5bfc\u51fa",
			"\u6b63\u5728\u5bfc\u51fa SQL \u6587\u4ef6",
		},
		"func (a *App) exportTablesSQL": {
			"\u65e0\u6548\u7684\u5bfc\u51fa\u6a21\u5f0f",
			"Export Tables (SQL)",
			"\u5bfc\u51fa\u5b8c\u6210",
			"\u6b63\u5728\u51c6\u5907\u6279\u91cf\u5bf9\u8c61\u5bfc\u51fa",
		},
		"func (a *App) ExportDatabaseSQL": {
			"\u6570\u636e\u5e93\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a",
			"Export %s (SQL)",
			"\u5bfc\u51fa\u5b8c\u6210",
		},
		"func (a *App) ExportSchemaSQL": {
			"\u6570\u636e\u5e93\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a",
			"\u6a21\u5f0f\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a",
			"Export %s.%s (SQL)",
			"\u672a\u5728\u6a21\u5f0f %s \u4e0b\u83b7\u53d6\u5230\u53ef\u5bfc\u51fa\u7684\u8868\u6216\u89c6\u56fe",
			"\u5bfc\u51fa\u5b8c\u6210",
		},
		"func (a *App) ExportData": {
			"Export Data",
			"Message: \"\u5199\u5165\u5931\u8d25\uff1a",
			"\u5bfc\u51fa\u5b8c\u6210",
			"\u6b63\u5728\u51c6\u5907\u5bfc\u51fa",
		},
		"func (a *App) ExportQuery": {
			"\u67e5\u8be2\u8bed\u53e5\u4e0d\u80fd\u4e3a\u7a7a",
			"Export Query Result",
			"\u4ec5\u652f\u6301 SELECT/WITH \u67e5\u8be2\u5bfc\u51fa",
			"Message: \"\u5199\u5165\u5931\u8d25\uff1a",
			"\u5bfc\u51fa\u5b8c\u6210",
			"\u6b63\u5728\u51c6\u5907\u5bfc\u51fa",
		},
		"func (r *exportProgressReporter) Finalizing": {
			"\u6b63\u5728\u5b8c\u6210\u6587\u4ef6\u5199\u5165",
			"\u6b63\u5728\u5c01\u88c5\u5e76\u538b\u7f29 XLSX \u6587\u4ef6",
			"\u6b63\u5728\u5b8c\u6210 CSV \u5199\u5165",
		},
		"func (r *exportProgressReporter) Done": {
			"\u5bfc\u51fa\u5b8c\u6210",
		},
		"func (r *exportProgressReporter) Error": {
			"\u5bfc\u51fa\u5931\u8d25",
		},
		"func resolveBatchObjectsTargetName": {
			"\u5f53\u524d\u6570\u636e\u5e93",
			`fmt.Sprintf("%s · %d 个对象", safeDbName, len(objectNames))`,
		},
		"func (a *App) ExportDatabasesSQLWithOptions": {
			"\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u6570\u636e\u5e93",
			"Title: \"\u9009\u62e9\u6279\u91cf\u5bfc\u51fa\u76ee\u5f55\"",
			`fmt.Sprintf("%d 个数据库", len(normalizedDbNames))`,
			"\u6b63\u5728\u51c6\u5907\u6279\u91cf\u5e93\u5bfc\u51fa",
			`fmt.Sprintf("正在导出 %s (%d/%d)", name, index+1, len(normalizedDbNames))`,
			"Message: \"\u5bfc\u51fa\u5b8c\u6210\"",
		},
		"func (a *App) exportDatabaseSQLToFile": {
			"\u6570\u636e\u5e93\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a",
		},
		"func (c *countingExportConsumer) SetColumns": {
			"\u6b63\u5728\u5199\u5165\u6587\u4ef6",
		},
		"func (c *countingExportConsumer) ConsumeRow": {
			"\u6b63\u5728\u5199\u5165\u6587\u4ef6",
		},
		"func (c *countingExportConsumer) ConsumeRowValues": {
			"\u6b63\u5728\u5199\u5165\u6587\u4ef6",
		},
		"func exportQueryResultToFile": {
			"\u6b63\u5728\u67e5\u8be2\u6570\u636e",
		},
		"func writeRowsToFileWithReporter": {
			"\u6b63\u5728\u5199\u5165\u6587\u4ef6",
		},
	}

	for signature, literals := range checks {
		functionSource := methodsFileFunctionSource(t, source, signature)
		for _, literal := range literals {
			if strings.Contains(functionSource, literal) {
				t.Fatalf("%s still contains raw export text %q", signature, literal)
			}
		}
	}
}

func TestExportBackendCatalogKeysExist(t *testing.T) {
	catalogs, err := i18n.LoadCatalogs()
	if err != nil {
		t.Fatalf("LoadCatalogs() error = %v", err)
	}

	keys := []string{
		"file.backend.dialog.export_connections",
		"file.backend.dialog.export_data",
		"file.backend.dialog.export_database_sql",
		"file.backend.dialog.export_query_result",
		"file.backend.dialog.export_table",
		"file.backend.dialog.export_tables_sql",
		"file.backend.error.database_name_required",
		"file.backend.error.invalid_export_mode",
		"file.backend.error.query_required",
		"file.backend.error.schema_export_no_objects",
		"file.backend.error.schema_name_required",
		"file.backend.error.select_with_query_required",
		"file.backend.dialog.select_batch_export_directory",
		"file.backend.error.target_file_overwrite_confirmation_required",
		"file.backend.error.write_failed",
		"file.backend.filter.connection_package",
		"file.backend.message.export_completed",
		"data_export.progress.stage.preparing_export",
		"data_export.progress.stage.exporting_sql_file",
		"data_export.progress.stage.preparing_batch_tables_export",
		"data_export.progress.stage.preparing_batch_databases_export",
		"data_export.progress.stage.exporting_item_with_progress",
		"data_export.progress.stage.querying_data",
		"data_export.progress.stage.writing_file",
		"data_export.progress.stage.finalizing_file_write",
		"data_export.progress.stage.finalizing_xlsx_package",
		"data_export.progress.stage.finalizing_csv_write",
		"data_export.progress.stage.export_failed",
		"data_export.workbench.target.batch_databases",
		"data_export.workbench.target.batch_tables",
		"data_export.workbench.target.current_database",
		"sidebar.message.select_database_required",
	}
	for _, language := range i18n.SupportedLanguages() {
		catalog := catalogs[language]
		for _, key := range keys {
			if strings.TrimSpace(catalog[key]) == "" {
				t.Fatalf("%s catalog missing export key %q", language, key)
			}
		}
	}
}

func TestExecuteSQLFileMessagesUseLocalizedText(t *testing.T) {
	sourceBytes, err := os.ReadFile("methods_file.go")
	if err != nil {
		t.Fatalf("read methods_file.go: %v", err)
	}
	source := string(sourceBytes)

	for _, literal := range []string{
		"\u6587\u4ef6\u8def\u5f84\u4e3a\u7a7a",
		"\u65e0\u6cd5\u6253\u5f00\u6587\u4ef6:",
		"\u7528\u6237\u53d6\u6d88\u6267\u884c",
		"\u6267\u884c\u5df2\u53d6\u6d88\u3002\u5df2\u6267\u884c",
		"\u6587\u4ef6\u8bfb\u53d6\u9519\u8bef:",
		"\u6267\u884c\u5b8c\u6210\u3002\u6210\u529f",
		"\u9519\u8bef\u8be6\u60c5\uff08\u524d ",
		"\u6761\u9519\u8bef\u672a\u663e\u793a",
		"\u5df2\u53d1\u9001\u53d6\u6d88\u8bf7\u6c42",
		"\u672a\u627e\u5230\u8be5\u4efb\u52a1",
		"\u6279\u91cf\u6267\u884c\u5931\u8d25:",
		"\u56de\u6eda\u5931\u8d25:",
		"\u6761\u8bed\u53e5\u6267\u884c\u5931\u8d25",
		"\u6761\u8d77\u7684\u6279\u91cf\u8bed\u53e5\u6267\u884c\u5931\u8d25",
	} {
		if strings.Contains(source, literal) {
			t.Fatalf("methods_file.go still contains raw SQL file execution text %q", literal)
		}
	}
}

func TestAppLogBackendMessagesUseLocalizedText(t *testing.T) {
	sourceBytes, err := os.ReadFile("methods_file.go")
	if err != nil {
		t.Fatalf("read methods_file.go: %v", err)
	}
	source := string(sourceBytes)

	for _, literal := range []string{
		"\u5f53\u524d\u672a\u627e\u5230 GoNavi \u65e5\u5fd7\u6587\u4ef6",
	} {
		if strings.Contains(source, literal) {
			t.Fatalf("methods_file.go still contains raw app log backend text %q", literal)
		}
	}
}

func TestExecuteSQLFileMessageCatalogKeysExist(t *testing.T) {
	catalogs, err := i18n.LoadCatalogs()
	if err != nil {
		t.Fatalf("LoadCatalogs() error = %v", err)
	}

	keys := []string{
		"file.backend.error.file_path_empty",
		"file.backend.error.open_file_failed",
		"file.backend.error.read_file_error_summary",
		"file.backend.error.sql_file_batch_execution_failed",
		"file.backend.error.sql_file_batch_rollback_failed",
		"file.backend.error.sql_file_statement_execution_failed",
		"file.backend.error.task_not_found",
		"file.backend.message.cancel_requested",
		"file.backend.message.execution_cancelled",
		"file.backend.message.execution_completed",
		"file.backend.message.execution_error_detail_header",
		"file.backend.message.execution_more_errors",
		"file.backend.message.statement_failed",
		"file.backend.message.user_cancelled",
	}
	for _, language := range i18n.SupportedLanguages() {
		catalog := catalogs[language]
		for _, key := range keys {
			if strings.TrimSpace(catalog[key]) == "" {
				t.Fatalf("%s catalog missing SQL file execution key %q", language, key)
			}
		}
	}
}

func TestAppLogBackendMessageCatalogKeysExist(t *testing.T) {
	catalogs, err := i18n.LoadCatalogs()
	if err != nil {
		t.Fatalf("LoadCatalogs() error = %v", err)
	}

	keys := []string{
		"file.backend.error.app_log_file_not_found",
	}
	for _, language := range i18n.SupportedLanguages() {
		catalog := catalogs[language]
		for _, key := range keys {
			if strings.TrimSpace(catalog[key]) == "" {
				t.Fatalf("%s catalog missing app log key %q", language, key)
			}
		}
	}
}
