package provider

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"GoNavi-Wails/internal/ai"
)

func TestPluginRequestPreflightAndSchemaPrecision(t *testing.T) {
	p := pluginStreamFixture()
	req := pluginStreamRequest()
	req.Tools = []ai.Tool{{Type: "function", Function: ai.ToolFunction{Name: "inspect", Parameters: json.RawMessage(`{"type":"object","properties":{"id":{"enum":[9007199254740993]}}}`)}}}
	snapshot, _, err := p.prepareRequest(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(snapshot)
	if err != nil || !strings.Contains(string(raw), "9007199254740993") {
		t.Fatal("tool schema numeric precision changed")
	}
	cyclic := map[string]any{}
	cyclic["self"] = cyclic
	req.Tools[0].Function.Parameters = cyclic
	if _, _, err = p.prepareRequest(req); err == nil {
		t.Fatal("cyclic schema accepted")
	}
	req.Tools[0].Function.Parameters = map[string]any{"type": "object", "description": strings.Repeat("x", 1<<20)}
	if _, _, err = p.prepareRequest(req); err == nil {
		t.Fatal("huge schema encoded before rejection")
	}
	req = pluginStreamRequest()
	req.Messages = make([]ai.Message, 512)
	for i := range req.Messages {
		req.Messages[i] = ai.Message{Role: "user", Content: strings.Repeat("x", 2048)}
	}
	if _, _, err = p.prepareRequest(req); err == nil {
		t.Fatal("aggregate text overflow accepted")
	}
	req = pluginStreamRequest()
	req.Tools = []ai.Tool{{Type: "function", Function: ai.ToolFunction{Name: "inspect", Parameters: map[string]any{"type": string([]byte{0xff})}}}}
	if _, _, err = p.prepareRequest(req); err == nil {
		t.Fatal("invalid UTF8 schema repaired silently")
	}
}
func TestPluginPreflightCountsJSONNodesNotGoInterfaceWrappers(t *testing.T) {
	values := make([]any, 20000)
	for i := range values {
		values[i] = 0
	}
	p := pluginStreamFixture()
	req := pluginStreamRequest()
	req.Tools = []ai.Tool{{Type: "function", Function: ai.ToolFunction{Name: "inspect", Parameters: map[string]any{"enum": values}}}}
	if _, _, err := p.prepareRequest(req); err != nil {
		t.Fatalf("valid small encoded schema rejected: %v", err)
	}
}

func TestPluginNamespaceAndUnsupportedHeaderTimeout(t *testing.T) {
	for _, typ := range []string{"plugin", "Plugin:test.models:chat", " plugin:test.models:chat", "plugin :test.models:chat", "plugin:test.models:chat"} {
		c := pluginTestConfig()
		c.Type = typ
		if p, err := NewProvider(c); p != nil || err == nil {
			t.Fatal("global constructor bypassed plugin binding")
		}
	}
	c := pluginTestConfig()
	c.HeaderTimeoutSeconds = 10
	if err := ValidatePluginConfig(c); err == nil {
		t.Fatal("unhonored header timeout accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	p := pluginStreamFixture()
	if err := p.ChatStream(ctx, ai.ChatRequest{}, nil); err != context.Canceled {
		t.Fatal("caller cancellation lost to invalid arguments")
	}
}
func TestPluginCompletionByteCountAndTerminalBounds(t *testing.T) {
	raw := []byte(`{"events":[{"sequence":1,"type":"delta","content":"x"}]}`)
	state := pluginCompletionState{bytes: 8 << 20}
	if _, err := state.batch(raw); err == nil {
		t.Fatal("aggregate completion budget bypassed")
	}
	state = pluginCompletionState{sequence: 65536}
	if _, err := state.batch(raw); err == nil {
		t.Fatal("event count budget bypassed")
	}
	calls := []ai.ToolCall{{ID: "one", Type: "function", Function: ai.ToolCallFunction{Name: "inspect", Arguments: "{}"}}}
	if err := validatePluginToolCalls(calls, map[string]bool{"other": true}); err == nil {
		t.Fatal("unoffered tool accepted")
	}
	calls = append(calls, calls[0])
	if err := validatePluginToolCalls(calls, nil); err == nil {
		t.Fatal("duplicate tool ids accepted")
	}
	calls[1].ID = "two"
	calls[0].Function.Arguments = `{"x":1,"x":2}`
	if err := validatePluginToolCalls(calls, nil); err == nil {
		t.Fatal("ambiguous tool arguments accepted")
	}
}
