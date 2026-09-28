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
		{model: "deepseek-v4.1-flash", want: defaultOpenAIResponsesReasoningMaxOutputTokens},
		{model: "deepseek/deepseek-v4-flash-0731", want: defaultOpenAIResponsesReasoningMaxOutputTokens},
		{model: "DeepSeek-R1", want: defaultOpenAIResponsesReasoningMaxOutputTokens},
		{model: "gpt-4o", want: defaultOpenAIMaxTokens},
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

func TestOpenAIResponsesDefaultMaxOutputTokensForEndpointRecognizesDeepSeekHost(t *testing.T) {
	if got := openAIResponsesDefaultMaxOutputTokensForEndpoint("v4.1-flash", "https://api.deepseek.com/v1"); got != defaultOpenAIResponsesReasoningMaxOutputTokens {
		t.Fatalf("DeepSeek endpoint alias budget = %d, want %d", got, defaultOpenAIResponsesReasoningMaxOutputTokens)
	}
}

func TestNormalizeOpenAIResponsesMaxOutputTokensPreservesExplicitBudget(t *testing.T) {
	tests := []struct {
		name  string
		model string
		given int
		want  int
	}{
		{name: "deepseek explicit legacy-sized budget", model: "deepseek/deepseek-v4-flash-0731", given: defaultOpenAIMaxTokens, want: defaultOpenAIMaxTokens},
		{name: "openai explicit legacy-sized budget", model: "gpt-5.6", given: defaultOpenAIMaxTokens, want: defaultOpenAIMaxTokens},
		{name: "explicit small budget", model: "gpt-5.6", given: 512, want: 512},
		{name: "ordinary model default", model: "gpt-4o", given: 0, want: defaultOpenAIMaxTokens},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeOpenAIResponsesMaxOutputTokens(tt.model, tt.given); got != tt.want {
				t.Fatalf("normalized max output tokens = %d, want %d", got, tt.want)
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

func TestOpenAIResponsesProviderPreservesExplicitReasoningBudget(t *testing.T) {
	providerInstance, err := NewOpenAIResponsesProvider(ai.ProviderConfig{
		Type: "custom", APIFormat: "openai-responses", APIKey: "sk-test", Model: "deepseek-v4.1-flash", MaxTokens: defaultOpenAIMaxTokens,
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	responsesProvider, ok := providerInstance.(*OpenAIResponsesProvider)
	if !ok {
		t.Fatalf("expected OpenAIResponsesProvider, got %T", providerInstance)
	}
	if responsesProvider.config.MaxTokens != defaultOpenAIMaxTokens {
		t.Fatalf("explicit reasoning max tokens = %d, want %d", responsesProvider.config.MaxTokens, defaultOpenAIMaxTokens)
	}
}

func TestOpenAIResponsesProviderSendsExplicitNoneEffortForDeepSeekAliases(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"resp_none","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}]}`))
	}))
	defer server.Close()

	providerInstance, err := NewOpenAIResponsesProvider(ai.ProviderConfig{
		Type: "custom", APIFormat: "openai-responses", APIKey: "sk-test", BaseURL: server.URL + "/v1",
		Model: "deepseek/deepseek-v4-flash-0731", ThinkingIntensity: "off",
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
		t.Fatalf("expected DeepSeek reasoning budget %d, got %#v", defaultOpenAIResponsesReasoningMaxOutputTokens, received["max_output_tokens"])
	}
	reasoning, _ := received["reasoning"].(map[string]any)
	if reasoning["effort"] != "none" {
		t.Fatalf("expected explicit none reasoning effort, got %#v", received["reasoning"])
	}
	if _, present := reasoning["summary"]; present {
		t.Fatalf("DeepSeek reasoning request must not include summary, got %#v", reasoning)
	}
}
