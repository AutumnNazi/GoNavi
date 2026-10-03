package aiservice

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/provider"
)

func catalogTool(name string) ai.Tool {
	return ai.Tool{Type: "function", Function: ai.ToolFunction{Name: name, Description: name + " description", Parameters: map[string]any{"type": "object"}}}
}

func sqlCall(id, sql string) ai.ToolCall {
	args, _ := json.Marshal(map[string]any{"connectionId": "conn-1", "sql": sql})
	return ai.ToolCall{ID: id, Type: "function", Function: ai.ToolCallFunction{Name: "execute_sql", Arguments: string(args)}}
}

func TestTheBuiltinAIGetsOnlyTheCuratedReadOnlyTools(t *testing.T) {
	var catalog []ai.Tool
	for _, name := range []string{"get_connections", "get_server_version", "get_databases", "get_tables", "get_views", "get_columns", "get_indexes", "get_table_ddl", "execute_sql", "jvm_probe"} {
		catalog = append(catalog, catalogTool(name))
	}
	got := builtinAITools(catalog)
	var names []string
	for _, tool := range got {
		names = append(names, tool.Function.Name)
	}
	if strings.Join(names, ",") != "get_server_version,get_databases,get_tables,get_columns,get_table_ddl,execute_sql" {
		t.Fatalf("tools offered to the small model: %v", names)
	}
	execute := got[len(got)-1].Function
	if !strings.Contains(execute.Description, "read-only") {
		t.Fatalf("execute_sql must be described as read-only: %q", execute.Description)
	}
	schema, _ := json.Marshal(execute.Parameters)
	if strings.Contains(string(schema), "allowMutating") || strings.Contains(string(schema), "maxRowsPerResult") {
		t.Fatalf("the read-only execute_sql must not offer the write switch: %s", schema)
	}
	if catalog[8].Function.Description != "execute_sql description" {
		t.Fatalf("the catalog the other providers see must be left alone: %+v", catalog[8])
	}
}

func TestOnlyReadOnlyQueriesReachTheTool(t *testing.T) {
	calls := []ai.ToolCall{
		{ID: "a", Type: "function", Function: ai.ToolCallFunction{Name: "get_tables", Arguments: `{"connectionId":"conn-1"}`}},
		sqlCall("b", "SELECT * FROM orders LIMIT 100"),
		sqlCall("c", "DELETE FROM orders"),
		{ID: "d", Type: "function", Function: ai.ToolCallFunction{Name: "jvm_probe", Arguments: `{}`}},
	}
	allowed, content := guardBuiltinAIToolCalls(calls, "Let me look.", "NOT RUN:")
	if len(allowed) != 2 || allowed[0].ID != "a" || allowed[1].ID != "b" {
		t.Fatalf("allowed: %+v", allowed)
	}
	if content != "Let me look.\n\nNOT RUN:\n\n```sql\nDELETE FROM orders\n```" {
		t.Fatalf("the person must see what was not run, and why: %q", content)
	}
}

func TestAnAnswerWithOnlyQueriesIsUntouched(t *testing.T) {
	calls := []ai.ToolCall{sqlCall("b", "SHOW TABLES")}
	allowed, content := guardBuiltinAIToolCalls(calls, "", "NOT RUN:")
	if len(allowed) != 1 || content != "" {
		t.Fatalf("allowed=%+v content=%q", allowed, content)
	}
}

func TestAStreamedCallIsJudgedWhenComplete(t *testing.T) {
	var got []ai.StreamChunk
	guard := newBuiltinAIStreamGuard(func(chunk ai.StreamChunk) { got = append(got, chunk) }, "NOT RUN:")
	// The provider reports the call as it builds up; nothing goes out until it is complete.
	guard.push(ai.StreamChunk{ToolCalls: []ai.ToolCall{sqlCall("c", "UPDATE")}})
	guard.push(ai.StreamChunk{ToolCalls: []ai.ToolCall{sqlCall("c", "UPDATE orders SET paid = 1")}})
	guard.push(ai.StreamChunk{Done: true})
	guard.finish()

	if len(got) != 2 {
		t.Fatalf("expected the note, then the end: %+v", got)
	}
	if !strings.Contains(got[0].Content, "UPDATE orders SET paid = 1") || len(got[0].ToolCalls) != 0 {
		t.Fatalf("a write must come back as text, not as a call: %+v", got[0])
	}
	if !got[1].Done || len(got[1].ToolCalls) != 0 {
		t.Fatalf("the end chunk passes on: %+v", got[1])
	}
}

func TestAStreamedQueryIsPassedOnBeforeTheEnd(t *testing.T) {
	var got []ai.StreamChunk
	guard := newBuiltinAIStreamGuard(func(chunk ai.StreamChunk) { got = append(got, chunk) }, "NOT RUN:")
	guard.push(ai.StreamChunk{Content: "Checking."})
	guard.push(ai.StreamChunk{ToolCalls: []ai.ToolCall{sqlCall("b", "SELECT 1")}, Done: true})
	guard.finish()

	if len(got) != 3 || got[0].Content != "Checking." || len(got[1].ToolCalls) != 1 || !got[2].Done || len(got[2].ToolCalls) != 0 {
		t.Fatalf("text, then the call, then the end: %+v", got)
	}
}

func TestAStreamThatStopsWithoutAnEndStillReleasesItsCalls(t *testing.T) {
	var got []ai.StreamChunk
	guard := newBuiltinAIStreamGuard(func(chunk ai.StreamChunk) { got = append(got, chunk) }, "NOT RUN:")
	guard.push(ai.StreamChunk{ToolCalls: []ai.ToolCall{sqlCall("b", "SELECT 1")}})
	guard.finish()
	guard.finish()
	if len(got) != 1 || len(got[0].ToolCalls) != 1 {
		t.Fatalf("the held call goes out once: %+v", got)
	}
}

type recordingProvider struct {
	provider.Provider
	request ai.ChatRequest
	stream  []ai.StreamChunk
}

func (p *recordingProvider) Chat(_ context.Context, req ai.ChatRequest) (*ai.ChatResponse, error) {
	p.request = req
	return &ai.ChatResponse{ToolCalls: []ai.ToolCall{sqlCall("c", "DROP TABLE orders")}}, nil
}

func (p *recordingProvider) ChatStream(_ context.Context, req ai.ChatRequest, callback func(ai.StreamChunk)) error {
	p.request = req
	for _, chunk := range p.stream {
		callback(chunk)
	}
	return nil
}

func TestTheBuiltinWrapperCuratesToolsAndGuardsBothPaths(t *testing.T) {
	inner := &recordingProvider{stream: []ai.StreamChunk{{ToolCalls: []ai.ToolCall{sqlCall("c", "TRUNCATE orders")}}, {Done: true}}}
	wrapped := builtinAIPromptProvider{Provider: inner, readOnlyNotice: "NOT RUN:"}
	request := ai.ChatRequest{Messages: []ai.Message{{Role: "user", Content: "hi"}}, Tools: []ai.Tool{catalogTool("get_connections"), catalogTool("execute_sql")}}

	response, err := wrapped.Chat(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(inner.request.Tools) != 1 || inner.request.Tools[0].Function.Name != "execute_sql" {
		t.Fatalf("tools sent: %+v", inner.request.Tools)
	}
	if len(response.ToolCalls) != 0 || !strings.Contains(response.Content, "DROP TABLE orders") {
		t.Fatalf("a DROP must not reach the tool: %+v", response)
	}

	var chunks []ai.StreamChunk
	if err := wrapped.ChatStream(context.Background(), request, func(chunk ai.StreamChunk) { chunks = append(chunks, chunk) }); err != nil {
		t.Fatal(err)
	}
	for _, chunk := range chunks {
		if len(chunk.ToolCalls) != 0 {
			t.Fatalf("a TRUNCATE must not reach the tool: %+v", chunks)
		}
	}
	if len(chunks) != 2 || !strings.Contains(chunks[0].Content, "TRUNCATE orders") || !chunks[1].Done {
		t.Fatalf("stream: %+v", chunks)
	}
}
