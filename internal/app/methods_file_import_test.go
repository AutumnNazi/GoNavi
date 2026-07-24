package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/secretstore"
	"GoNavi-Wails/internal/uievents"

	"github.com/xuri/excelize/v2"
)

func TestReadImportedConnectionConfigFileRejectsOversizedFiles(t *testing.T) {
	for _, ext := range []string{connectionPackageExtension, ".json"} {
		t.Run(ext, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "connections"+ext)

			file, err := os.Create(path)
			if err != nil {
				t.Fatalf("Create returned error: %v", err)
			}
			if err := file.Truncate(connectionImportMaxFileBytes + 1); err != nil {
				file.Close()
				t.Fatalf("Truncate returned error: %v", err)
			}
			if err := file.Close(); err != nil {
				t.Fatalf("Close returned error: %v", err)
			}

			_, err = readImportedConnectionConfigFile(path)
			if !errors.Is(err, errConnectionImportFileTooLarge) {
				t.Fatalf("oversized import file should return errConnectionImportFileTooLarge, got: %v", err)
			}
		})
	}
}

func TestBuildImportPreviewCSVStreamKeepsFirstFiveRows(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "users.csv")
	var builder strings.Builder
	builder.WriteString("id,name\n")
	for i := 1; i <= 7; i++ {
		builder.WriteString(fmt.Sprintf("%d,user_%d\n", i, i))
	}
	if err := os.WriteFile(path, []byte(builder.String()), 0o600); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	preview, err := buildImportPreview(path, 5)
	if err != nil {
		t.Fatalf("buildImportPreview returned error: %v", err)
	}

	if !reflect.DeepEqual(preview.Columns, []string{"id", "name"}) {
		t.Fatalf("unexpected columns: %#v", preview.Columns)
	}
	if preview.TotalRows != 7 {
		t.Fatalf("expected 7 rows, got %d", preview.TotalRows)
	}
	if len(preview.PreviewRows) != 5 {
		t.Fatalf("expected 5 preview rows, got %d", len(preview.PreviewRows))
	}
	if got := preview.PreviewRows[0]["name"]; got != "user_1" {
		t.Fatalf("expected first preview row name user_1, got %#v", got)
	}
	if got := preview.PreviewRows[4]["id"]; got != "5" {
		t.Fatalf("expected fifth preview row id 5, got %#v", got)
	}
}

func TestBuildImportRowFromValuesPreservesPositionsWhenHeaderContainsBlankColumns(t *testing.T) {
	row := buildImportRowFromValues([]string{"id", "", "name"}, []string{"1", "ignored", "alice"})
	if got := row["id"]; got != "1" {
		t.Fatalf("expected id to stay aligned, got %#v", got)
	}
	if got := row["name"]; got != "alice" {
		t.Fatalf("expected name to stay aligned, got %#v", got)
	}
	if _, ok := row[""]; ok {
		t.Fatal("blank header column should not be written into row map")
	}
}

func TestBuildImportPreviewXLSXStreamSupportsInlineStrings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "inline.xlsx")
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("创建 xlsx 文件失败: %v", err)
	}

	writer, err := newXLSXExportFileWriter(file, 0)
	if err != nil {
		t.Fatalf("创建 xlsx writer 失败: %v", err)
	}
	if err := writer.SetColumns([]string{"id", "name"}); err != nil {
		t.Fatalf("SetColumns 失败: %v", err)
	}
	if err := writer.ConsumeRowValues([]interface{}{1, "alice"}); err != nil {
		t.Fatalf("写入第 1 行失败: %v", err)
	}
	if err := writer.ConsumeRowValues([]interface{}{2, "bob"}); err != nil {
		t.Fatalf("写入第 2 行失败: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("关闭 xlsx writer 失败: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("关闭 xlsx 文件失败: %v", err)
	}

	preview, err := buildImportPreview(path, 5)
	if err != nil {
		t.Fatalf("buildImportPreview 返回错误: %v", err)
	}
	if !reflect.DeepEqual(preview.Columns, []string{"id", "name"}) {
		t.Fatalf("unexpected columns: %#v", preview.Columns)
	}
	if preview.TotalRows != 2 {
		t.Fatalf("expected 2 rows, got %d", preview.TotalRows)
	}
	if got := preview.PreviewRows[1]["name"]; got != "bob" {
		t.Fatalf("expected second row name bob, got %#v", got)
	}
}

func TestBuildImportPreviewXLSXStreamSupportsSharedStrings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shared.xlsx")
	workbook := excelize.NewFile()
	if err := workbook.SetCellValue("Sheet1", "A1", "id"); err != nil {
		t.Fatalf("设置表头失败: %v", err)
	}
	if err := workbook.SetCellValue("Sheet1", "B1", "name"); err != nil {
		t.Fatalf("设置表头失败: %v", err)
	}
	if err := workbook.SetCellValue("Sheet1", "A2", "1"); err != nil {
		t.Fatalf("设置数据失败: %v", err)
	}
	if err := workbook.SetCellValue("Sheet1", "B2", "alice"); err != nil {
		t.Fatalf("设置数据失败: %v", err)
	}
	if err := workbook.SetCellValue("Sheet1", "A3", "2"); err != nil {
		t.Fatalf("设置数据失败: %v", err)
	}
	if err := workbook.SetCellValue("Sheet1", "B3", "bob"); err != nil {
		t.Fatalf("设置数据失败: %v", err)
	}
	if err := workbook.SaveAs(path); err != nil {
		t.Fatalf("保存 shared-string xlsx 失败: %v", err)
	}
	if err := workbook.Close(); err != nil {
		t.Fatalf("关闭 shared-string xlsx 失败: %v", err)
	}

	preview, err := buildImportPreview(path, 5)
	if err != nil {
		t.Fatalf("buildImportPreview 返回错误: %v", err)
	}
	if !reflect.DeepEqual(preview.Columns, []string{"id", "name"}) {
		t.Fatalf("unexpected columns: %#v", preview.Columns)
	}
	if preview.TotalRows != 2 {
		t.Fatalf("expected 2 rows, got %d", preview.TotalRows)
	}
	if got := preview.PreviewRows[0]["name"]; got != "alice" {
		t.Fatalf("expected first row name alice, got %#v", got)
	}
	if got := preview.PreviewRows[1]["id"]; got != "2" {
		t.Fatalf("expected second row id 2, got %#v", got)
	}
}

type fakeImportRowWriter struct {
	columns          []string
	batchCalls       int
	singleCalls      int
	batchSizes       []int
	batchRows        []map[string]interface{}
	batchErr         error
	singleErrByRowID map[interface{}]error
	afterSingleCall  func()
}

type noopImportEventEmitter struct{}

func (noopImportEventEmitter) Emit(string, ...any) {}

type cancellableImportTestDB struct {
	fakeMetadataRetryDB
	execCalls      int
	afterFirstExec func()
}

func (d *cancellableImportTestDB) Exec(string) (int64, error) {
	d.execCalls++
	if d.execCalls == 1 && d.afterFirstExec != nil {
		d.afterFirstExec()
	}
	return 1, nil
}

func (w *fakeImportRowWriter) SetColumns(columns []string) {
	w.columns = append([]string(nil), columns...)
}

func (w *fakeImportRowWriter) ApplyBatch(rows []map[string]interface{}) error {
	w.batchCalls++
	w.batchSizes = append(w.batchSizes, len(rows))
	w.batchRows = append(w.batchRows, cloneImportRows(rows)...)
	return w.batchErr
}

func (w *fakeImportRowWriter) ApplyOne(row map[string]interface{}) error {
	w.singleCalls++
	if w.afterSingleCall != nil {
		w.afterSingleCall()
	}
	if err, ok := w.singleErrByRowID[row["id"]]; ok {
		return err
	}
	return nil
}

func (w *fakeImportRowWriter) BatchEnabled() bool {
	return true
}

func TestImportColumnMappingConsumerStreamsMappedColumnsAndRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "users.csv")
	if err := os.WriteFile(path, []byte("User ID,Display Name,Ignored\n1,Alice,skip me\n"), 0o600); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	writer := &fakeImportRowWriter{}
	batchConsumer := newImportBatchConsumer(writer, 1000, 0, false, nil)
	consumer, err := newImportColumnMappingConsumer(batchConsumer, map[string]string{
		"User ID":      "ID",
		"Display Name": "display_name",
	}, []connection.ColumnDefinition{
		{Name: "id", Type: "bigint"},
		{Name: "display_name", Type: "varchar(255)"},
	})
	if err != nil {
		t.Fatalf("newImportColumnMappingConsumer returned error: %v", err)
	}

	if err := streamImportFile(path, consumer); err != nil {
		t.Fatalf("streamImportFile returned error: %v", err)
	}
	if err := batchConsumer.Flush(); err != nil {
		t.Fatalf("Flush returned error: %v", err)
	}

	if !reflect.DeepEqual(writer.columns, []string{"id", "display_name"}) {
		t.Fatalf("unexpected mapped columns: %#v", writer.columns)
	}
	wantRows := []map[string]interface{}{{"id": "1", "display_name": "Alice"}}
	if !reflect.DeepEqual(writer.batchRows, wantRows) {
		t.Fatalf("unexpected mapped rows: %#v", writer.batchRows)
	}
}

func TestImportColumnMappingConsumerNilMappingsPreserveLegacyHeaders(t *testing.T) {
	collector := newImportPreviewCollector(5)
	consumer, err := newImportColumnMappingConsumer(collector, nil, nil)
	if err != nil {
		t.Fatalf("newImportColumnMappingConsumer returned error: %v", err)
	}
	if err := consumer.SetColumns([]string{"Raw Header"}); err != nil {
		t.Fatalf("SetColumns returned error: %v", err)
	}
	if err := consumer.ConsumeRow(map[string]interface{}{"Raw Header": "value"}); err != nil {
		t.Fatalf("ConsumeRow returned error: %v", err)
	}
	result := collector.Result()
	if !reflect.DeepEqual(result.Columns, []string{"Raw Header"}) {
		t.Fatalf("legacy columns changed: %#v", result.Columns)
	}
	if got := result.PreviewRows[0]["Raw Header"]; got != "value" {
		t.Fatalf("legacy row changed: %#v", result.PreviewRows)
	}
}

func TestImportColumnMappingConsumerPrefersExactTargetWhenCaseDistinct(t *testing.T) {
	collector := newImportPreviewCollector(5)
	consumer, err := newImportColumnMappingConsumer(collector, map[string]string{
		"Source Value": "Foo",
	}, []connection.ColumnDefinition{
		{Name: "Foo", Type: "text"},
		{Name: "foo", Type: "integer"},
	})
	if err != nil {
		t.Fatalf("newImportColumnMappingConsumer returned error: %v", err)
	}
	if err := consumer.SetColumns([]string{"Source Value"}); err != nil {
		t.Fatalf("SetColumns returned error: %v", err)
	}
	if !reflect.DeepEqual(collector.columns, []string{"Foo"}) {
		t.Fatalf("unexpected exact mapped target: %#v", collector.columns)
	}
}

func TestImportColumnTypeLookupKeepsCaseDistinctTypes(t *testing.T) {
	lookup := newImportColumnTypeLookup([]connection.ColumnDefinition{
		{Name: "Foo", Type: "text"},
		{Name: "foo", Type: "boolean"},
		{Name: "event_id", Type: "bigint"},
	})
	if got := lookup.Resolve("Foo"); got != "text" {
		t.Fatalf("exact Foo type = %q, want text", got)
	}
	if got := lookup.Resolve("foo"); got != "boolean" {
		t.Fatalf("exact foo type = %q, want boolean", got)
	}
	if got := lookup.Resolve("FOO"); got != "" {
		t.Fatalf("ambiguous folded FOO type = %q, want empty", got)
	}
	if got := lookup.Resolve("EVENT_ID"); got != "bigint" {
		t.Fatalf("unique folded EVENT_ID type = %q, want bigint", got)
	}
	query, err := buildImportInsertQuery(
		"postgres",
		"events",
		[]string{"Foo", "foo"},
		map[string]interface{}{"Foo": "false", "foo": "false"},
		lookup,
	)
	if err != nil {
		t.Fatalf("buildImportInsertQuery returned error: %v", err)
	}
	if !strings.Contains(query, `("Foo", "foo") VALUES ('false', false)`) {
		t.Fatalf("case-distinct target types produced wrong SQL: %s", query)
	}
}

func TestImportColumnMappingConsumerRejectsInvalidMappings(t *testing.T) {
	targetColumns := []connection.ColumnDefinition{
		{Name: "id", Type: "bigint"},
		{Name: "display_name", Type: "varchar(255)"},
	}
	tests := []struct {
		name          string
		mappings      map[string]string
		headers       []string
		targetColumns []connection.ColumnDefinition
		wantInError   string
	}{
		{
			name:        "requires at least one selected target",
			mappings:    map[string]string{"User ID": ""},
			headers:     []string{"User ID"},
			wantInError: "至少",
		},
		{
			name:        "rejects unknown target",
			mappings:    map[string]string{"User ID": "missing"},
			headers:     []string{"User ID"},
			wantInError: "目标字段",
		},
		{
			name: "rejects duplicate targets",
			mappings: map[string]string{
				"User ID":      "id",
				"Display Name": "ID",
			},
			headers:     []string{"User ID", "Display Name"},
			wantInError: "重复",
		},
		{
			name:        "rejects unknown source",
			mappings:    map[string]string{"Missing Header": "id"},
			headers:     []string{"User ID"},
			wantInError: "源字段",
		},
		{
			name:     "rejects ambiguous case insensitive target",
			mappings: map[string]string{"Value": "FOO"},
			headers:  []string{"Value"},
			targetColumns: []connection.ColumnDefinition{
				{Name: "Foo", Type: "text"},
				{Name: "foo", Type: "integer"},
			},
			wantInError: "不明确",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			baseConsumer := newImportPreviewCollector(5)
			columns := targetColumns
			if tt.targetColumns != nil {
				columns = tt.targetColumns
			}
			consumer, err := newImportColumnMappingConsumer(baseConsumer, tt.mappings, columns)
			if err == nil {
				err = consumer.SetColumns(tt.headers)
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantInError) {
				t.Fatalf("error = %v, want substring %q", err, tt.wantInError)
			}
		})
	}
}

func TestImportDataWithProgressOptionsRejectsEmptyFilePathBeforeDatabaseAccess(t *testing.T) {
	app := &App{}
	wantMessage := app.appText("file.backend.error.import_file_empty", nil)
	result := app.ImportDataWithProgressOptions(connection.ConnectionConfig{}, "", "users", "  ", ImportFileOptions{})
	if result.Success {
		t.Fatal("empty file path should fail")
	}
	if result.Message != wantMessage {
		t.Fatalf("message = %q, want %q", result.Message, wantMessage)
	}
}

func TestImportDataWithProgressOptionsStopsByJobIDAndReturnsCommittedPartialResult(t *testing.T) {
	originalNewDatabaseFunc := newDatabaseFunc
	originalResolveDialConfigWithProxyFunc := resolveDialConfigWithProxyFunc
	t.Cleanup(func() {
		newDatabaseFunc = originalNewDatabaseFunc
		resolveDialConfigWithProxyFunc = originalResolveDialConfigWithProxyFunc
	})

	database := &cancellableImportTestDB{fakeMetadataRetryDB: fakeMetadataRetryDB{
		columns: []connection.ColumnDefinition{{Name: "id", Type: "bigint"}},
	}}
	newDatabaseFunc = func(string) (db.Database, error) { return database, nil }
	resolveDialConfigWithProxyFunc = func(config connection.ConnectionConfig) (connection.ConnectionConfig, error) {
		return config, nil
	}

	path := filepath.Join(t.TempDir(), "users.csv")
	if err := os.WriteFile(path, []byte("id\n1\n2\n3\n"), 0o600); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	app := NewAppWithSecretStore(secretstore.NewUnavailableStore("test"))
	app.ctx = uievents.WithEmitter(context.Background(), noopImportEventEmitter{})
	const jobID = "import-cancel-test"
	database.afterFirstExec = func() {
		cancelResult := app.CancelQuery(jobID)
		if !cancelResult.Success {
			t.Errorf("CancelQuery returned failure: %s", cancelResult.Message)
		}
		app.queryMu.Lock()
		_, retainedWhileStopping := app.runningQueries[jobID]
		app.queryMu.Unlock()
		if !retainedWhileStopping {
			t.Error("cancelled import job was unregistered before its owner stopped")
		}
	}

	result := app.ImportDataWithProgressOptions(
		connection.ConnectionConfig{Type: "mysql", Host: "127.0.0.1", Port: 3306, Database: "app"},
		"app",
		"users",
		path,
		ImportFileOptions{ColumnMappings: map[string]string{"id": "id"}, JobID: jobID},
	)
	if result.Success {
		t.Fatal("cancelled import should not be reported as a completed success")
	}
	payload, ok := result.Data.(map[string]interface{})
	if !ok {
		t.Fatalf("result data type = %T, want map[string]interface{}", result.Data)
	}
	if payload["cancelled"] != true || payload["success"] != 1 || payload["failed"] != 0 || payload["total"] != 1 {
		t.Fatalf("unexpected cancelled payload: %#v", payload)
	}
	if database.execCalls != 1 {
		t.Fatalf("Exec calls = %d, want 1", database.execCalls)
	}
	app.queryMu.Lock()
	_, stillRegistered := app.runningQueries[jobID]
	app.queryMu.Unlock()
	if stillRegistered {
		t.Fatal("cancelled import job remained registered")
	}
}

func TestImportDataWithProgressOptionsUsesOracleColumnMetadataFallback(t *testing.T) {
	originalNewDatabaseFunc := newDatabaseFunc
	originalResolveDialConfigWithProxyFunc := resolveDialConfigWithProxyFunc
	originalDriverRuntimeSupportStatusFunc := driverRuntimeSupportStatusFunc
	originalVerifyDriverAgentRevisionFunc := verifyDriverAgentRevisionFunc
	t.Cleanup(func() {
		newDatabaseFunc = originalNewDatabaseFunc
		resolveDialConfigWithProxyFunc = originalResolveDialConfigWithProxyFunc
		driverRuntimeSupportStatusFunc = originalDriverRuntimeSupportStatusFunc
		verifyDriverAgentRevisionFunc = originalVerifyDriverAgentRevisionFunc
	})

	fakeDB := &fakeMetadataRetryDB{
		queryResults: []fakeMetadataQueryResult{{
			match: "all_tab_columns",
			rows: []map[string]interface{}{
				{"COLUMN_NAME": "ID", "DATA_TYPE": "NUMBER", "DATA_PRECISION": 19, "NULLABLE": "N"},
				{"COLUMN_NAME": "DISPLAY_NAME", "DATA_TYPE": "VARCHAR2", "CHAR_LENGTH": 255, "NULLABLE": "Y"},
			},
			fields: []string{"COLUMN_NAME", "DATA_TYPE", "DATA_PRECISION", "CHAR_LENGTH", "NULLABLE"},
		}},
	}
	newDatabaseFunc = func(string) (db.Database, error) { return fakeDB, nil }
	resolveDialConfigWithProxyFunc = func(config connection.ConnectionConfig) (connection.ConnectionConfig, error) {
		return config, nil
	}
	driverRuntimeSupportStatusFunc = func(string) (bool, string) { return true, "" }
	verifyDriverAgentRevisionFunc = func(connection.ConnectionConfig) error { return nil }

	path := filepath.Join(t.TempDir(), "users.csv")
	if err := os.WriteFile(path, []byte("User ID,Display Name\n1,Alice\n"), 0o600); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	app := NewAppWithSecretStore(secretstore.NewUnavailableStore("test"))
	app.ctx = uievents.WithEmitter(context.Background(), noopImportEventEmitter{})
	result := app.ImportDataWithProgressOptions(
		connection.ConnectionConfig{Type: "oracle", Host: "127.0.0.1", Port: 1521, Database: "ORCL"},
		"APP",
		"USERS",
		path,
		ImportFileOptions{ColumnMappings: map[string]string{
			"User ID":      "ID",
			"Display Name": "DISPLAY_NAME",
		}},
	)
	if !result.Success {
		t.Fatalf("Oracle fallback columns should allow mapped import, got: %s", result.Message)
	}
	if fakeDB.columnSchema != "APP" || fakeDB.columnTable != "USERS" {
		t.Fatalf("GetColumns target = %q.%q, want APP.USERS", fakeDB.columnSchema, fakeDB.columnTable)
	}
	if len(fakeDB.queries) == 0 || !strings.Contains(fakeDB.queries[0], "all_tab_columns") {
		t.Fatalf("expected Oracle dictionary metadata fallback, queries=%v", fakeDB.queries)
	}
}

func TestImportBatchConsumerUsesBatchWriterInConfiguredBatches(t *testing.T) {
	writer := &fakeImportRowWriter{}
	consumer := newImportBatchConsumer(writer, 1000, 1201, true, nil)
	if err := consumer.SetColumns([]string{"id"}); err != nil {
		t.Fatalf("SetColumns returned error: %v", err)
	}
	for i := 1; i <= 1201; i++ {
		if err := consumer.ConsumeRow(map[string]interface{}{"id": i}); err != nil {
			t.Fatalf("ConsumeRow(%d) returned error: %v", i, err)
		}
	}
	if err := consumer.Flush(); err != nil {
		t.Fatalf("Flush returned error: %v", err)
	}

	if writer.batchCalls != 2 {
		t.Fatalf("expected 2 batch calls, got %d", writer.batchCalls)
	}
	if !reflect.DeepEqual(writer.batchSizes, []int{1000, 201}) {
		t.Fatalf("unexpected batch sizes: %#v", writer.batchSizes)
	}
	result := consumer.Result()
	if result.Success != 1201 || result.Failed != 0 || result.Total != 1201 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if writer.singleCalls != 0 {
		t.Fatalf("expected no single-row fallback, got %d calls", writer.singleCalls)
	}
}

func TestImportBatchConsumerFallsBackToSingleRowsWhenBatchFails(t *testing.T) {
	writer := &fakeImportRowWriter{
		batchErr: fmt.Errorf("batch failed"),
		singleErrByRowID: map[interface{}]error{
			2: fmt.Errorf("duplicate key"),
		},
	}
	consumer := newImportBatchConsumer(writer, 1000, 3, true, nil)
	if err := consumer.SetColumns([]string{"id"}); err != nil {
		t.Fatalf("SetColumns returned error: %v", err)
	}
	for i := 1; i <= 3; i++ {
		if err := consumer.ConsumeRow(map[string]interface{}{"id": i}); err != nil {
			t.Fatalf("ConsumeRow(%d) returned error: %v", i, err)
		}
	}
	if err := consumer.Flush(); err != nil {
		t.Fatalf("Flush returned error: %v", err)
	}

	result := consumer.Result()
	if result.Success != 2 || result.Failed != 1 || result.Total != 3 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if writer.batchCalls != 1 {
		t.Fatalf("expected 1 batch call, got %d", writer.batchCalls)
	}
	if writer.singleCalls != 3 {
		t.Fatalf("expected 3 single-row fallback calls, got %d", writer.singleCalls)
	}
	if len(result.ErrorLogs) != 1 || result.ErrorLogs[0] != "Row 2: duplicate key" {
		t.Fatalf("unexpected error logs: %#v", result.ErrorLogs)
	}
}

func TestImportBatchConsumerStopsSingleRowFallbackAfterCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	writer := &fakeImportRowWriter{
		batchErr:        fmt.Errorf("batch failed"),
		afterSingleCall: cancel,
	}
	consumer := newImportBatchConsumer(writer, 1000, 3, true, nil)
	consumer.SetContext(ctx)

	for i := 1; i <= 3; i++ {
		if err := consumer.ConsumeRow(map[string]interface{}{"id": i}); err != nil {
			t.Fatalf("ConsumeRow(%d) returned error: %v", i, err)
		}
	}

	err := consumer.Flush()
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Flush error = %v, want context.Canceled", err)
	}
	if writer.singleCalls != 1 {
		t.Fatalf("single-row fallback calls = %d, want 1", writer.singleCalls)
	}
	result := consumer.Result()
	if result.Success != 1 || result.Failed != 0 {
		t.Fatalf("unexpected partial result: %#v", result)
	}
}

func TestImportBatchConsumerDoesNotCountCancellationAsRowFailure(t *testing.T) {
	writer := &fakeImportRowWriter{
		batchErr:         fmt.Errorf("batch failed"),
		singleErrByRowID: map[interface{}]error{1: context.Canceled},
	}
	consumer := newImportBatchConsumer(writer, 1, 1, true, nil)

	err := consumer.ConsumeRow(map[string]interface{}{"id": 1})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("ConsumeRow error = %v, want context.Canceled", err)
	}
	result := consumer.Result()
	if result.Success != 0 || result.Failed != 0 {
		t.Fatalf("unexpected cancelled result: %#v", result)
	}
}

func TestImportBatchConsumerProgressIncludesJobID(t *testing.T) {
	writer := &fakeImportRowWriter{}
	var progress []importProgressState
	consumer := newImportBatchConsumer(writer, 1, 1, true, func(state importProgressState) {
		progress = append(progress, state)
	})
	consumer.jobID = "import-job-1"

	if err := consumer.ConsumeRow(map[string]interface{}{"id": 1}); err != nil {
		t.Fatalf("ConsumeRow returned error: %v", err)
	}
	if len(progress) != 1 {
		t.Fatalf("progress event count = %d, want 1", len(progress))
	}
	if progress[0].JobID != "import-job-1" {
		t.Fatalf("progress job id = %q, want import-job-1", progress[0].JobID)
	}
}
