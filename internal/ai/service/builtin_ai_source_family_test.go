package aiservice

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/runharness"
)

func TestNacosTurnOffersInspectSourceInsteadOfSQL(t *testing.T) {
	var tools []ai.Tool
	for _, name := range []string{"get_server_version", "get_tables", "execute_sql", "inspect_source"} {
		tools = append(tools, catalogTool(name))
	}
	got := toolNames(builtinAITurnTools(builtinAIToolsFor(tools, "nacos"), builtinAIKnown{tables: true}))
	if got != "inspect_source" {
		t.Fatalf("tools = %s", got)
	}
}

func TestSQLCallsOnNacosAreRewrittenToInspectSource(t *testing.T) {
	call := ai.ToolCall{ID: "1", Type: "function", Function: ai.ToolCallFunction{
		Name: "execute_sql", Arguments: `{"connectionId":"nac-1","sql":"DESCRIBE 订单;"}`,
	}}
	allowed, content := guardBuiltinAIToolCalls([]ai.ToolCall{call}, "", "NOT RUN:", builtinAITarget{family: "nacos", connectionID: "nac-1"})
	if content != "" || len(allowed) != 1 || allowed[0].Function.Name != "inspect_source" {
		t.Fatalf("allowed=%+v content=%q", allowed, content)
	}
	var args map[string]string
	if err := json.Unmarshal([]byte(allowed[0].Function.Arguments), &args); err != nil {
		t.Fatal(err)
	}
	if args["kind"] != "list_entries" || args["connectionId"] != "nac-1" {
		t.Fatalf("args = %#v", args)
	}
}

type namedConnectionCatalog struct {
	calls       []string
	connections []map[string]any
}

func (c *namedConnectionCatalog) List(context.Context) ([]runharness.ToolDescriptor, error) {
	return nil, nil
}

func (c *namedConnectionCatalog) Resolve(_ context.Context, name string) (runharness.ToolDescriptor, runharness.ToolExecutor, error) {
	return runharness.ToolDescriptor{Name: name}, c, nil
}

func (c *namedConnectionCatalog) Execute(_ context.Context, request runharness.ToolExecutionRequest) (runharness.ToolExecutionResult, error) {
	c.calls = append(c.calls, request.ToolName)
	if request.ToolName == "get_connections" {
		return runharness.ToolExecutionResult{Status: "completed", Value: map[string]any{"connections": c.connections}}, nil
	}
	return runharness.ToolExecutionResult{Status: "failed"}, runharness.ErrToolNotFound
}

func TestAskingForMySQLLeavesTheSelectedNacosConnection(t *testing.T) {
	catalog := &namedConnectionCatalog{connections: []map[string]any{
		{"id": "nac-1", "name": "Nacos", "type": "nacos"},
		{"id": "my-1", "name": "本地", "type": "mysql"},
		{"id": "my-2", "name": "测试", "type": "mysql"},
	}}
	s := &Service{agentToolCatalog: catalog}
	target, lines := s.builtinAIContextFor(context.Background(), builtinAITarget{connectionID: "nac-1"}, "那你连接MySQL")
	if target.connectionID != "" || target.family != "sql" || !target.allowedIDs["my-1"] || !target.allowedIDs["my-2"] {
		t.Fatalf("target = %+v", target)
	}
	if len(lines) != 1 || !strings.Contains(lines[0], "my-1") || !strings.Contains(lines[0], "my-2") || !strings.Contains(lines[0], "nac-1") {
		t.Fatalf("lines = %#v", lines)
	}
	if strings.Join(catalog.calls, ",") != "get_connections" {
		t.Fatalf("probes = %v", catalog.calls)
	}
	call := ai.ToolCall{ID: "1", Type: "function", Function: ai.ToolCallFunction{
		Name: "execute_sql", Arguments: `{"connectionId":"nac-1","sql":"DESCRIBE 订单;"}`,
	}}
	allowed, content := guardBuiltinAIToolCalls([]ai.ToolCall{call}, "", "NOT RUN:", target)
	if len(allowed) != 0 || !strings.Contains(content, "my-1") {
		t.Fatalf("allowed=%+v content=%q", allowed, content)
	}
}

func TestMentioningNacosDoesNotProbeSQL(t *testing.T) {
	catalog := &namedConnectionCatalog{connections: []map[string]any{
		{"id": "nac-1", "name": "Nacos", "type": "nacos"},
	}}
	s := &Service{agentToolCatalog: catalog}
	target, lines := s.builtinAIContextFor(context.Background(), builtinAITarget{}, "那你连上nacos，在berohost分组")
	if target.connectionID != "nac-1" || target.family != "nacos" {
		t.Fatalf("target = %+v", target)
	}
	if len(lines) != 2 || !strings.Contains(lines[1], "inspect_source") || !strings.Contains(lines[1], "list_entries") {
		t.Fatalf("lines = %#v", lines)
	}
	if strings.Join(catalog.calls, ",") != "get_connections" {
		t.Fatalf("probes = %v", catalog.calls)
	}
}
