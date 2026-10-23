package provider

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"GoNavi-Wails/internal/ai"
)

func TestPluginStartEnvelopeLimitRejectsBeforeStartRPC(t *testing.T) {
	tests := []struct {
		name    string
		prepare func(*pluginProvider, *ai.ChatRequest)
	}{
		{name: "selected key and headers exceed encoded bytes", prepare: func(p *pluginProvider, req *ai.ChatRequest) {
			p.config.APIKey = strings.Repeat("k", 16<<10)
			p.config.Headers = map[string]string{"X-Selected": strings.Repeat("h", 4096)}
			req.Messages[0].Content = strings.Repeat("x", (512<<10)-1024)
		}},
		{name: "wrapper exceeds request depth", prepare: func(_ *pluginProvider, req *ai.ChatRequest) {
			schema := strings.Repeat(`{"x":`, 28) + "0" + strings.Repeat("}", 28)
			req.Tools = []ai.Tool{{Type: "function", Function: ai.ToolFunction{Name: "inspect", Parameters: json.RawMessage(schema)}}}
		}},
		{name: "wrapper exceeds request node budget", prepare: func(_ *pluginProvider, req *ai.ChatRequest) {
			schema := `{"enum":[` + strings.Repeat("0,", 32739) + "0]}"
			req.Tools = []ai.Tool{{Type: "function", Function: ai.ToolFunction{Name: "inspect", Parameters: json.RawMessage(schema)}}}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			p := pluginStreamFixture()
			req := pluginStreamRequest()
			test.prepare(p, &req)
			prepared, _, err := p.prepareRequest(req)
			if err != nil {
				t.Fatalf("request-only fixture must be valid: %v", err)
			}
			envelope := pluginRequestEnvelope{ProtocolVersion: 1, Operation: "start", ProviderID: p.pin.ProviderID, RequestID: strings.Repeat("a", 43), Config: &pluginSelectedConfig{BaseURL: p.config.BaseURL, APIKey: p.config.APIKey, Model: p.config.Model, Headers: p.config.Headers}, Request: &prepared}
			raw, err := json.Marshal(envelope)
			if err != nil || pluginJSON(raw, 512<<10) == nil {
				t.Fatal("full-envelope fixture must exceed a strict limit")
			}
			starts, pulls, cancels, callbacks := 0, 0, 0, 0
			p.invoke = func(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
				switch pluginOperation(t, raw).Operation {
				case "start":
					starts++
					return json.RawMessage(`{"accepted":true}`), nil
				case "pull":
					pulls++
					return json.RawMessage(`{"events":[{"sequence":1,"type":"done","finishReason":"stop"}]}`), nil
				case "cancel":
					cancels++
					return json.RawMessage(`{"ok":true}`), nil
				}
				return nil, ErrPluginProviderOperation
			}
			err = p.ChatStream(context.Background(), req, func(ai.StreamChunk) { callbacks++ })
			if err != ErrPluginProviderConfig || starts != 0 || pulls != 0 || callbacks != 0 || cancels != 1 {
				t.Fatalf("oversized envelope crossed start boundary: err=%v starts=%d pulls=%d callbacks=%d cleanup=%d", err, starts, pulls, callbacks, cancels)
			}
		})
	}
}
