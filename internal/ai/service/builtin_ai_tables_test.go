package aiservice

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/runharness"
)

// kingbaseLabTables is what get_tables returns for the KingBase lab database: the person's tables
// in dbms_job, and the system schemas KingBase lists alongside them.
var kingbaseLabTables = []string{
	"dbms_job.lab_customers", "dbms_job.lab_employees", "dbms_job.lab_order_items", "dbms_job.lab_orders", "dbms_job.lab_products",
	"sys_hm.check_param", "sys_hm.check_type", "sysmac.sysmac_label",
}

func TestTheTablesLineListsTheCurrentSchema(t *testing.T) {
	got := builtinAITablesLine(kingbaseLabTables, "dbms_job")
	want := "Tables in this database (use these exact names): dbms_job.lab_customers, dbms_job.lab_employees, dbms_job.lab_order_items, dbms_job.lab_orders, dbms_job.lab_products. 3 more in other schemas (call get_tables to see them)"
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
	if all := builtinAITablesLine(kingbaseLabTables, ""); !strings.Contains(all, "sysmac.sysmac_label") || strings.Contains(all, "more") {
		t.Fatalf("without a schema every table is listed: %s", all)
	}
	if other := builtinAITablesLine(kingbaseLabTables, "public"); !strings.Contains(other, "dbms_job.lab_orders") {
		t.Fatalf("a schema with no tables of its own lists them all: %s", other)
	}
	if builtinAITablesLine(nil, "dbms_job") != "" {
		t.Fatal("no tables, no line")
	}
}

func TestALongTableListIsCutAndCounted(t *testing.T) {
	var names []string
	for i := 0; i < 400; i++ {
		names = append(names, "orders_archive_"+strings.Repeat("x", 10)+string(rune('a'+i%26)))
	}
	got := builtinAITablesLine(names, "")
	if len(got) > builtinAITablesMaxBytes+80 || !strings.Contains(got, " more (call get_tables to see them)") {
		t.Fatalf("%d bytes: %s", len(got), got)
	}
}

type countingTableCatalog struct {
	mu    sync.Mutex
	calls []string
	fail  bool
}

func (c *countingTableCatalog) List(context.Context) ([]runharness.ToolDescriptor, error) {
	return nil, nil
}

func (c *countingTableCatalog) Resolve(_ context.Context, name string) (runharness.ToolDescriptor, runharness.ToolExecutor, error) {
	if name != "get_tables" {
		return runharness.ToolDescriptor{}, nil, runharness.ErrToolNotFound
	}
	return runharness.ToolDescriptor{Name: name}, c, nil
}

func (c *countingTableCatalog) Execute(_ context.Context, request runharness.ToolExecutionRequest) (runharness.ToolExecutionResult, error) {
	c.mu.Lock()
	c.calls = append(c.calls, string(request.Arguments))
	c.mu.Unlock()
	if c.fail {
		return runharness.ToolExecutionResult{Status: "failed"}, errors.New("connection refused")
	}
	return runharness.ToolExecutionResult{Status: "completed", Value: map[string]any{"connectionId": "kb", "tables": kingbaseLabTables, "views": []string{}}}, nil
}

func TestTheTablesAreReadOnceAndKeptForAWhile(t *testing.T) {
	catalog := &countingTableCatalog{}
	s := &Service{agentToolCatalog: catalog}
	target := builtinAITarget{connectionID: "kb", dbName: "gonavi_kingbase_lab", schemaName: "dbms_job"}

	if got := s.builtinAITables(context.Background(), target); len(got) != len(kingbaseLabTables) {
		t.Fatalf("got %v", got)
	}
	_ = s.builtinAITables(context.Background(), target)
	if len(catalog.calls) != 1 || catalog.calls[0] != `{"connectionId":"kb","dbName":"gonavi_kingbase_lab"}` {
		t.Fatalf("read once, for the person's connection and database: %v", catalog.calls)
	}
	_ = s.builtinAITables(context.Background(), builtinAITarget{connectionID: "kb", dbName: "test"})
	if len(catalog.calls) != 2 {
		t.Fatalf("another database is read on its own: %v", catalog.calls)
	}
}

func TestTablesThatCannotBeReadAreLeftOut(t *testing.T) {
	failing := &Service{agentToolCatalog: &countingTableCatalog{fail: true}}
	if got := failing.builtinAITables(context.Background(), builtinAITarget{connectionID: "kb"}); got != nil {
		t.Fatalf("got %v", got)
	}
	if got := (&Service{}).builtinAITables(context.Background(), builtinAITarget{connectionID: "kb"}); got != nil {
		t.Fatalf("no tool catalog: %v", got)
	}
	if got := (&Service{agentToolCatalog: &countingTableCatalog{}}).builtinAITables(context.Background(), builtinAITarget{}); got != nil {
		t.Fatalf("no connection: %v", got)
	}
}

// Regression (2026-10-03): asked for "some data" on KingBase, the model queried dbms_job.job_info,
// a table it made up. It now reads the real names next to the database it is told about.
func TestTheModelSeesTheRealTablesNextToTheDatabase(t *testing.T) {
	inner := &recordingProvider{stream: []ai.StreamChunk{{Content: "ok", Done: true}}}
	wrapped := builtinAIPromptProvider{Provider: inner, tables: func(_ context.Context, target builtinAITarget) []string {
		if target != (builtinAITarget{connectionID: "kb", dbName: "gonavi_kingbase_lab", schemaName: "dbms_job"}) {
			t.Errorf("target %+v", target)
		}
		return kingbaseLabTables
	}}
	request := ai.ChatRequest{Messages: []ai.Message{
		workspaceMessage(t, map[string]any{"connectionId": "kb", "dbName": "gonavi_kingbase_lab", "schemaName": "dbms_job"}),
		{Role: "user", Content: "随便找点数据给我看看"},
	}}
	if err := wrapped.ChatStream(context.Background(), request, func(ai.StreamChunk) {}); err != nil {
		t.Fatal(err)
	}
	content := inner.request.Messages[len(inner.request.Messages)-1].Content
	want := "Database: gonavi_kingbase_lab. Connection id (for tools): kb. Schema: dbms_job\n\nTables in this database (use these exact names): dbms_job.lab_customers"
	if !strings.Contains(content, want) {
		t.Fatalf("the tables must follow the database line:\n%s", content)
	}
}
