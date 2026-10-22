package plugin

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func aiTestStart(provider, id string) json.RawMessage {
	raw, err := json.Marshal(map[string]any{"protocolVersion": 1, "operation": "start", "providerId": provider, "requestId": id,
		"config": AIProviderConfig{Model: "test-model", APIKey: "private-api-key"}, "request": AIProviderRequest{Messages: []AIProviderMessage{{Role: "user", Content: "Hello"}}, MaxTokens: 10}})
	if err != nil {
		return nil
	}
	return raw
}
func aiTestControl(operation, provider, id string) json.RawMessage {
	raw, err := json.Marshal(map[string]any{"protocolVersion": 1, "operation": operation, "providerId": provider, "requestId": id})
	if err != nil {
		return nil
	}
	return raw
}
func aiTestDispatcher(t *testing.T, limits AIProviderLimits, generate AIProviderGenerate) *AIProviderDispatcher {
	t.Helper()
	registration := AIProviderRegistration{Models: []AIModel{{ID: "test-model", Name: "Local test", ContextWindow: 1024, MaxOutputTokens: 128}}, SupportsTools: true, Generate: generate}
	dispatcher, err := NewAIProviderDispatcher(context.Background(), AIProviderOptions{Providers: map[string]AIProviderRegistration{"one": registration, "two": registration}, Limits: limits})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := dispatcher.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	return dispatcher
}
func aiTestPull(t *testing.T, d *AIProviderDispatcher, provider, id string) []AIProviderEvent {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result, err := d.Handle(ctx, aiTestControl("pull", provider, id))
	if err != nil {
		t.Fatal(err)
	}
	batch, ok := result.(AIProviderBatch)
	if !ok {
		t.Fatalf("wrong pull result: %T", result)
	}
	encoded, err := json.Marshal(batch)
	if err != nil || len(encoded) > aiProviderMaxBatchBytes || len(batch.Events) > 16 {
		t.Fatalf("invalid batch: %v", err)
	}
	events := make([]AIProviderEvent, 0, len(batch.Events))
	for _, raw := range batch.Events {
		var event AIProviderEvent
		if len(raw) > aiProviderMaxEventBytes || json.Unmarshal(raw, &event) != nil {
			t.Fatal("invalid event bytes")
		}
		events = append(events, event)
	}
	return events
}
func aiTestWait(t *testing.T, condition func() bool) {
	t.Helper()
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for {
		if condition() {
			return
		}
		select {
		case <-timer.C:
			t.Fatal("state did not settle")
		case <-ticker.C:
		}
	}
}
