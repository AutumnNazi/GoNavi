package main

import (
	"encoding/json"
	"strings"
	"testing"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func TestSDKValidatesOfferedToolNames(t *testing.T) {
	body := toolFrame(t, 0, "call", "lookup", `{"id":42}`) + strings.ReplaceAll(stopFrame, "stop", "tool_calls") + doneFrame
	for _, offered := range []string{"lookup", "other"} {
		t.Run(offered, func(t *testing.T) {
			server := serveSSE(t, body)
			provider := testHTTPProvider(t)
			ctx := testContext(t)
			dispatcher, err := plugin.NewAIProviderDispatcher(ctx, plugin.AIProviderOptions{
				Providers: map[string]plugin.AIProviderRegistration{
					"http": {Models: providerModels(), SupportsTools: true, Generate: provider.generate},
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(dispatcher.Abort)
			start := testStart(server.URL)
			start.Request.Tools = []plugin.AIProviderTool{{Type: "function", Function: plugin.AIProviderToolFunction{
				Name: offered, Parameters: json.RawMessage(`{"type":"object"}`),
			}}}
			startArgs := dispatcherArgs(t, "start", &start)
			if _, err := dispatcher.Handle(ctx, startArgs); err != nil {
				t.Fatal(err)
			}
			result, err := dispatcher.Handle(ctx, dispatcherArgs(t, "pull", &start))
			if err != nil {
				t.Fatal(err)
			}
			batch := result.(plugin.AIProviderBatch)
			if len(batch.Events) != 1 {
				t.Fatal("expected one terminal snapshot")
			}
			var event plugin.AIProviderEvent
			if err := json.Unmarshal(batch.Events[0], &event); err != nil {
				t.Fatal(err)
			}
			if offered == "lookup" && (event.Type != "done" || len(event.ToolCalls) != 1) {
				t.Fatal("offered function was rejected")
			}
			if offered != "lookup" && (event.Type != "error" || event.Code != "generation_failed" || len(event.ToolCalls) != 0) {
				t.Fatal("unoffered function escaped SDK validation")
			}
		})
	}
}

func dispatcherArgs(t *testing.T, operation string, start *plugin.AIProviderStart) json.RawMessage {
	t.Helper()
	value := map[string]any{"protocolVersion": 1, "operation": operation, "providerId": start.ProviderID, "requestId": start.RequestID}
	if operation == "start" {
		value["config"] = start.Config
		value["request"] = start.Request
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
