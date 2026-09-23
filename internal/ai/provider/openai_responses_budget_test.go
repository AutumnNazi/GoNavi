package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"GoNavi-Wails/internal/ai"
)

func TestOpenAIResponsesDefaultMaxOutputTokens(t *testing.T) {
	tests := []struct {
		model string
		want  int
	}{
		{model: "gpt-5.6", want: defaultOpenAIResponsesReasoningMaxOutputTokens},
		{model: "openai/gpt-5.4", want: defaultOpenAIResponsesReasoningMaxOutputTokens},
		{model: "o3-mini", want: defaultOpenAIResponsesReasoningMaxOutputTokens},
		{model: "o4-mini", want: defaultOpenAIResponsesReasoningMaxOutputTokens},
		{model: "gpt-4o", want: defaultOpenAIMaxTokens},
		{model: "deepseek-v4-flash", want: defaultOpenAIMaxTokens},
		{model: "gpt-test", want: defaultOpenAIMaxTokens},
	}
	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			if got := openAIResponsesDefaultMaxOutputTokens(tt.model); got != tt.want {
				t.Fatalf("default max output tokens = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestOpenAIResponsesProviderUsesReasoningOutputBudgetByDefault(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"resp_budget","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"pong"}]}]}`))
	}))
	defer server.Close()

	providerInstance, err := NewOpenAIResponsesProvider(ai.ProviderConfig{
		Type: "openai", APIFormat: "openai-responses", APIKey: "sk-test", BaseURL: server.URL + "/v1", Model: "gpt-5.6",
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if _, err := providerInstance.Chat(context.Background(), ai.ChatRequest{
		Messages: []ai.Message{{Role: "user", Content: "ping"}},
	}); err != nil {
		t.Fatalf("chat: %v", err)
	}
	if received["max_output_tokens"] != float64(defaultOpenAIResponsesReasoningMaxOutputTokens) {
		t.Fatalf("expected reasoning max_output_tokens %d, got %#v", defaultOpenAIResponsesReasoningMaxOutputTokens, received["max_output_tokens"])
	}
}

func TestOpenAIResponsesProviderKeepsExplicitOutputBudget(t *testing.T) {
	providerInstance, err := NewOpenAIResponsesProvider(ai.ProviderConfig{
		Type: "openai", APIFormat: "openai-responses", APIKey: "sk-test", Model: "gpt-5.6", MaxTokens: 512,
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	responsesProvider, ok := providerInstance.(*OpenAIResponsesProvider)
	if !ok {
		t.Fatalf("expected OpenAIResponsesProvider, got %T", providerInstance)
	}
	if responsesProvider.config.MaxTokens != 512 {
		t.Fatalf("explicit max tokens = %d, want 512", responsesProvider.config.MaxTokens)
	}
}
