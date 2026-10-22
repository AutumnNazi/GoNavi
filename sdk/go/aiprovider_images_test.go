package plugin

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func aiImageDataURL(payload []byte) string {
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(payload)
}

func aiImageRegistration() AIProviderRegistration {
	return AIProviderRegistration{
		Models:         []AIModel{{ID: "test-model", Name: "Local test", ContextWindow: 1024, MaxOutputTokens: 128}},
		SupportsImages: true,
		Generate: func(context.Context, AIProviderStart, AIProviderEmit) (AIProviderCompletion, error) {
			return AIProviderCompletion{}, nil
		},
	}
}

func aiImageStart(t *testing.T, request AIProviderRequest) aiProviderEnvelope {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"protocolVersion": 1, "operation": "start", "providerId": "one", "requestId": "image-start",
		"config": AIProviderConfig{Model: "test-model"}, "request": request,
	})
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := parseAIProviderEnvelope(raw)
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func TestAIProviderStartAcceptsBoundedImages(t *testing.T) {
	large := aiImageDataURL(make([]byte, 768<<10))
	request := AIProviderRequest{Messages: []AIProviderMessage{{Role: "user", Content: "describe", Images: []string{large}}}, MaxTokens: 8}
	start, _, err := validateAIProviderStart(aiImageStart(t, request), aiImageRegistration())
	if err != nil {
		t.Fatalf("declared image rejected: %v", err)
	}
	if len(start.Request.Messages[0].Images) != 1 || start.Request.Messages[0].Images[0] != large {
		t.Fatal("image bytes dropped")
	}
}

func TestAIProviderStartRejectsUndeclaredOrUnboundedImages(t *testing.T) {
	valid := aiImageDataURL([]byte("hello"))
	cases := map[string]struct {
		request AIProviderRequest
		support bool
	}{
		"provider without capability": {request: AIProviderRequest{Messages: []AIProviderMessage{{Role: "user", Content: "x", Images: []string{valid}}}}},
		"assistant image":             {support: true, request: AIProviderRequest{Messages: []AIProviderMessage{{Role: "assistant", Content: "x", Images: []string{valid}}}}},
		"five images":                 {support: true, request: AIProviderRequest{Messages: []AIProviderMessage{{Role: "user", Content: "x", Images: []string{valid, valid, valid, valid, valid}}}}},
		"remote url":                  {support: true, request: AIProviderRequest{Messages: []AIProviderMessage{{Role: "user", Content: "x", Images: []string{"https://example.invalid/a.png"}}}}},
		"empty payload":               {support: true, request: AIProviderRequest{Messages: []AIProviderMessage{{Role: "user", Content: "x", Images: []string{"data:image/png;base64,"}}}}},
		"invalid base64":              {support: true, request: AIProviderRequest{Messages: []AIProviderMessage{{Role: "user", Content: "x", Images: []string{"data:image/png;base64,!!!"}}}}},
	}
	for name, test := range cases {
		t.Run(name, func(t *testing.T) {
			registration := aiImageRegistration()
			registration.SupportsImages = test.support
			if _, _, err := validateAIProviderStart(aiImageStart(t, test.request), registration); err == nil {
				t.Fatal("unbounded or undeclared image accepted")
			}
		})
	}
}

func TestAIProviderStartKeepsTextRequestBudget(t *testing.T) {
	heavy := AIProviderRequest{Messages: []AIProviderMessage{{Role: "user", Content: strings.Repeat("x", aiProviderMaxRequestBytes+1024)}}, MaxTokens: 8}
	if _, _, err := validateAIProviderStart(aiImageStart(t, heavy), aiImageRegistration()); err == nil {
		t.Fatal("oversized text request accepted")
	}
}
