package app

import (
	"context"
	"slices"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/mockdata"
	"GoNavi-Wails/internal/uievents"
)

func mockDataTestNow() time.Time {
	return time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
}

type mockDataEventRecorder struct {
	names  []string
	states []importProgressState
}

func (r *mockDataEventRecorder) Emit(name string, args ...any) {
	r.names = append(r.names, name)
	if len(args) > 0 {
		if state, ok := args[0].(importProgressState); ok {
			r.states = append(r.states, state)
		}
	}
}

func TestMockDataKeysFromMetadata(t *testing.T) {
	indexes := []connection.IndexDefinition{
		{Name: "orders_pkey", ColumnName: "id", NonUnique: 0, SeqInIndex: 1},
		{Name: "uk_tenant_code", ColumnName: "code", NonUnique: 0, SeqInIndex: 2},
		{Name: "uk_tenant_code", ColumnName: "tenant_id", NonUnique: 0, SeqInIndex: 1},
		{Name: "idx_created", ColumnName: "created_at", NonUnique: 1, SeqInIndex: 1},
	}
	foreignKeys := []connection.ForeignKeyDefinition{
		{ColumnName: "Tenant_ID", RefTableName: "tenants", RefColumnName: "id"},
		{ColumnName: "broken", RefTableName: "", RefColumnName: "id"},
	}
	keys := mockDataKeysFromMetadata(indexes, foreignKeys)
	if !slices.Equal(keys.PrimaryKey, []string{"id"}) {
		t.Fatalf("primary key = %v", keys.PrimaryKey)
	}
	if len(keys.Unique) != 1 || !slices.Equal(keys.Unique[0], []string{"tenant_id", "code"}) {
		t.Fatalf("unique = %v", keys.Unique)
	}
	if fk, ok := keys.ForeignKeys["tenant_id"]; !ok || fk.Table != "tenants" {
		t.Fatalf("foreign keys = %v", keys.ForeignKeys)
	}
	if _, ok := keys.ForeignKeys["broken"]; ok {
		t.Fatal("foreign key without parent table should be ignored")
	}
}

func TestRunMockDataWriteBatchesThroughImportWriter(t *testing.T) {
	columns := []connection.ColumnDefinition{
		{Name: "id", Type: "bigint", Nullable: "NO", Extra: "auto_increment", Key: "PRI"},
		{Name: "name", Type: "varchar(20)", Nullable: "YES"},
		{Name: "score", Type: "int", Nullable: "YES"},
	}
	database := &issue1025CapturingImportDB{fakeMetadataRetryDB: fakeMetadataRetryDB{columns: columns}}
	profiles := mockdata.ClassifyTable(mockdata.FamilyMySQL, columns, mockdata.TableKeys{})
	table := &mockDataTable{dbInst: database, dbType: "mysql", family: mockdata.FamilyMySQL, columns: columns, profiles: profiles}
	plan := mockdata.Plan{RowCount: 2500, Seed: 1, Locale: mockdata.LocaleEN, Columns: mockdata.SuggestPlans(profiles, mockdata.LocaleEN, mockDataTestNow())}
	producer, err := mockdata.NewProducer(plan, profiles, nil)
	if err != nil {
		t.Fatalf("NewProducer: %v", err)
	}
	recorder := &mockDataEventRecorder{}
	app := &App{ctx: uievents.WithEmitter(context.Background(), recorder)}

	result := app.runMockDataWrite(context.Background(), table, "people", producer, "job-1", MockDataRunOptions{})
	if !result.Success {
		t.Fatalf("result = %+v", result)
	}
	payload, ok := result.Data.(MockDataRunResult)
	if !ok || payload.Success != 2500 || payload.Failed != 0 {
		t.Fatalf("payload = %+v", result.Data)
	}
	if len(database.batchChanges) != 3 {
		t.Fatalf("batches = %d, want 3 (1000-row batches)", len(database.batchChanges))
	}
	first := database.batchChanges[0].Inserts[0]
	if _, exists := first["id"]; exists {
		t.Fatalf("auto-increment column should be left to the database: %v", first)
	}
	if _, isText := first["score"].(string); !isText {
		t.Fatalf("values should be cell text like CSV import: %#v", first["score"])
	}
	if len(recorder.states) == 0 || recorder.names[0] != mockDataProgressEvent || recorder.states[len(recorder.states)-1].JobID != "job-1" {
		t.Fatalf("progress events = %v %+v", recorder.names, recorder.states)
	}
}

func TestRunMockDataWriteReportsCancellation(t *testing.T) {
	columns := []connection.ColumnDefinition{{Name: "name", Type: "varchar(20)", Nullable: "YES"}}
	database := &issue1025CapturingImportDB{fakeMetadataRetryDB: fakeMetadataRetryDB{columns: columns}}
	profiles := mockdata.ClassifyTable(mockdata.FamilyMySQL, columns, mockdata.TableKeys{})
	producer, err := mockdata.NewProducer(mockdata.Plan{RowCount: 10, Columns: mockdata.SuggestPlans(profiles, "", mockDataTestNow())}, profiles, nil)
	if err != nil {
		t.Fatalf("NewProducer: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	table := &mockDataTable{dbInst: database, dbType: "mysql", family: mockdata.FamilyMySQL, columns: columns, profiles: profiles}
	result := (&App{}).runMockDataWrite(ctx, table, "people", producer, "job-2", MockDataRunOptions{})
	payload, _ := result.Data.(MockDataRunResult)
	if result.Success || !payload.Cancelled {
		t.Fatalf("cancelled run should report cancellation: %+v", result)
	}
}

func TestMockDataErrorMessageTranslatesPlanErrors(t *testing.T) {
	app := &App{}
	_, err := mockdata.NewProducer(mockdata.Plan{RowCount: 0}, nil, nil)
	message := app.mockDataErrorMessage(err)
	if message == "" || message == "mock_data.backend.error.row_count_out_of_range" {
		t.Fatalf("plan error should be translated, got %q", message)
	}
}
