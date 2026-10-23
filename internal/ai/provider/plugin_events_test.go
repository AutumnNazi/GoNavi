package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/plugin"
)

func TestPluginEventRejectsAmbiguousOrIncompleteWire(t *testing.T) {
	tests := []string{
		"{}", "{\"events\":null}", "{\"Events\":[]}", "{\"events\":[],\"events\":[]}",
		"{\"events\":[{\"sequence\":0,\"type\":\"delta\",\"content\":\"x\"}]}",
		"{\"events\":[{\"sequence\":2,\"type\":\"delta\",\"content\":\"x\"}]}",
		"{\"events\":[{\"sequence\":1,\"type\":\"delta\",\"content\":\"\"}]}",
		"{\"events\":[{\"sequence\":1,\"type\":\"delta\",\"content\":\"\\ud800\"}]}",
		"{\"events\":[{\"sequence\":1,\"type\":\"delta\",\"content\":\"x\",\"toolCalls\":[]}]}",
		"{\"events\":[{\"sequence\":1,\"type\":\"done\",\"finishReason\":\"stop\"},{\"sequence\":2,\"type\":\"delta\",\"content\":\"late\"}]}",
		"{\"events\":[{\"sequence\":1,\"type\":\"done\",\"finishReason\":\"tool_calls\"}]}",
		"{\"events\":[{\"sequence\":1,\"type\":\"done\",\"finishReason\":\"stop\",\"usage\":null}]}",
		"{\"events\":[{\"sequence\":1,\"type\":\"done\",\"finishReason\":\"stop\",\"usage\":{\"promptTokens\":1,\"completionTokens\":-1,\"totalTokens\":0}}]}",
		"{\"events\":[{\"sequence\":1,\"type\":\"done\",\"finishReason\":\"stop\",\"usage\":{\"promptTokens\":1.5,\"completionTokens\":1,\"totalTokens\":2}}]}",
		"{\"events\":[{\"sequence\":1,\"type\":\"error\",\"code\":\"HTTP 503 secret\"}]}",
	}
	for i, raw := range tests {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			s := pluginCompletionState{offered: map[string]bool{}, supportsTools: true}
			if _, err := s.batch([]byte(raw)); err == nil {
				t.Fatal("malformed batch accepted")
			}
		})
	}
}
func TestPluginRequestBoundsAndSelectedProjection(t *testing.T) {
	p := pluginStreamFixture()
	req := pluginStreamRequest()
	req.Tools = make([]ai.Tool, 128)
	for i := range req.Tools {
		req.Tools[i] = ai.Tool{Type: "function", Function: ai.ToolFunction{Name: fmt.Sprintf("tool_%d", i), Parameters: map[string]any{"type": "object"}}}
	}
	copied, names, err := p.prepareRequest(req)
	if err != nil || len(names) != 128 || copied.MaxTokens != 128 {
		t.Fatalf("128 tool definitions rejected: %v", err)
	}
	req.Tools = append(req.Tools, req.Tools[0])
	if _, _, err = p.prepareRequest(req); err == nil {
		t.Fatal("129 definitions accepted")
	}
	req = pluginStreamRequest()
	req.Messages[0].Images = []string{"data:image/png;base64,secret"}
	if _, _, err = p.prepareRequest(req); err == nil {
		t.Fatal("images silently dropped")
	}
	req = pluginStreamRequest()
	req.MaxTokens = 129
	if _, _, err = p.prepareRequest(req); err == nil {
		t.Fatal("model output cap exceeded")
	}
	req = pluginStreamRequest()
	req.Messages[0].Content = strings.Repeat("x", 512<<10)
	if _, _, err = p.prepareRequest(req); err == nil {
		t.Fatal("encoded request cap exceeded")
	}
	p.config.SecretRef = "UNRELATED_SECRET_REF"
	p.config.HasSecret = true
	p.config.APIKey = "SELECTED_KEY"
	p.config.Headers = map[string]string{"Authorization": "SELECTED_HEADER"}
	p.invoke = func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		if strings.Contains(string(raw), "UNRELATED_SECRET_REF") || strings.Contains(string(raw), "hasSecret") || strings.Contains(string(raw), "cliEnv") {
			t.Error("authority or unrelated configuration projected")
		}
		r := pluginOperation(t, raw)
		switch r.Operation {
		case "start":
			if r.Config == nil || r.Config.APIKey != "SELECTED_KEY" || r.Config.Headers["Authorization"] != "SELECTED_HEADER" {
				t.Error("selected secret not projected")
			}
			return []byte("{\"accepted\":true}"), nil
		case "cancel":
			return []byte("{\"ok\":true}"), nil
		}
		return []byte("{\"events\":[{\"sequence\":1,\"type\":\"done\",\"finishReason\":\"stop\"}]}"), nil
	}
	if _, err := p.Chat(context.Background(), pluginStreamRequest()); err != nil {
		t.Fatal(err)
	}
}
func TestPluginCatalogIsMetadataOnlyAndContextFirst(t *testing.T) {
	d := plugin.AIProvider{ID: "chat", Name: "Chat", Command: "generate", Models: []plugin.AIModel{{ID: "model-1", Name: "Model", ContextWindow: 4096, MaxOutputTokens: 128}}}
	status := plugin.Status{Manifest: plugin.Manifest{ID: "test.models", Version: "1.0.0", Permissions: []string{"ai.providers"}, Backend: &plugin.Backend{}, Contributes: plugin.Contributions{AIProviders: []plugin.AIProvider{d}}}, Digest: strings.Repeat("a", 64), State: plugin.StateDisabled}
	f := NewPluginFactory(func(context.Context) (PluginProviderSnapshot, error) {
		return PluginProviderSnapshot{Statuses: []plugin.Status{status}}, nil
	}, func(context.Context) (*plugin.Manager, error) {
		t.Fatal("metadata requested execution authority")
		return nil, nil
	})
	views, err := f.Catalog(context.Background())
	if err != nil || len(views) != 1 || views[0].Available || views[0].Reason != "disabled" {
		t.Fatalf("disabled metadata lost: %+v %v", views, err)
	}
	views[0].Models[0].ID = "mutated"
	again, _ := f.Catalog(context.Background())
	if again[0].Models[0].ID != "model-1" {
		t.Fatal("mutable catalog alias")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = f.Bind(ctx, ai.ProviderConfig{}); err != context.Canceled {
		t.Fatalf("bind cancellation lost: %v", err)
	}
	if _, err = f.Resolve(ctx, nil); err != context.Canceled {
		t.Fatalf("resolve cancellation lost: %v", err)
	}
}
