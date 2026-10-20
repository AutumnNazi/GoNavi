package mcpserver

import (
	"context"
	"encoding/json"
	"testing"

	"GoNavi-Wails/internal/ai/runharness"
	appcore "GoNavi-Wails/internal/app"
	"GoNavi-Wails/internal/connection"
)

type inspectBackend struct {
	*fakeBackend
	query appcore.SourceInspectQuery
}

func (b *inspectBackend) InspectSource(_ context.Context, _ connection.ConnectionConfig, query appcore.SourceInspectQuery) connection.QueryResult {
	b.query = query
	return connection.QueryResult{Success: true, Data: []string{"berohost"}}
}

func TestInspectSourceToolReadsTheSavedConnection(t *testing.T) {
	backend := &inspectBackend{fakeBackend: catalogBackend()}
	backend.editableConnection.Config.Type = "nacos"
	catalog := NewAgentToolCatalog(backend)
	_, executor, err := catalog.Resolve(context.Background(), "inspect_source")
	if err != nil {
		t.Fatal(err)
	}
	result, err := executor.Execute(context.Background(), runharness.ToolExecutionRequest{
		ToolName:  "inspect_source",
		Effect:    runharness.ToolEffectReadOnly,
		Arguments: json.RawMessage(`{"connectionId":"conn-1","kind":"list_entries","namespace":"public","group":"berohost"}`),
	})
	if err != nil || result.Status != "completed" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if backend.query.Kind != "list_entries" || backend.query.Group != "berohost" || backend.query.Namespace != "public" {
		t.Fatalf("query = %+v", backend.query)
	}
}
