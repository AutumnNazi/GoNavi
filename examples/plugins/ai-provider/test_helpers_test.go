package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

const stopFrame = "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n"
const doneFrame = "data: [DONE]\n\n"

func testStart(baseURL string) plugin.AIProviderStart {
	return plugin.AIProviderStart{
		ProviderID: "http", RequestID: strings.Repeat("A", 43),
		Config: plugin.AIProviderConfig{BaseURL: baseURL, Model: "gpt-4o-mini"},
		Request: plugin.AIProviderRequest{
			Messages:    []plugin.AIProviderMessage{{Role: "user", Content: "local fixture"}},
			Temperature: 0.2, MaxTokens: 16,
		},
	}
}

func newRequestID(t *testing.T) string {
	t.Helper()
	var value [32]byte
	if _, err := rand.Read(value[:]); err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(value[:])
}

func testHTTPProvider(t *testing.T) *httpProvider {
	t.Helper()
	provider := newHTTPProvider()
	t.Cleanup(provider.client.CloseIdleConnections)
	return provider
}

func testContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func drainRequest(t *testing.T, request *http.Request) {
	t.Helper()
	if _, err := io.Copy(io.Discard, request.Body); err != nil {
		t.Errorf("read local fixture request: %v", err)
	}
}

func serveSSE(t *testing.T, body string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		if _, err := w.Write([]byte(body)); err != nil {
			t.Errorf("write local SSE fixture: %v", err)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func collectSSE(t *testing.T, body string) (plugin.AIProviderCompletion, []plugin.AIProviderDelta, error) {
	t.Helper()
	server := serveSSE(t, body)
	var deltas []plugin.AIProviderDelta
	completion, err := testHTTPProvider(t).generate(testContext(t), testStart(server.URL), func(delta plugin.AIProviderDelta) error {
		deltas = append(deltas, delta)
		return nil
	})
	return completion, deltas, err
}

func assertFailure(t *testing.T, err error, code string) {
	t.Helper()
	var failure *plugin.AIProviderFailure
	if !errors.As(err, &failure) || failure.Code != code {
		t.Fatalf("expected safe %s failure, got %v", code, err)
	}
	if strings.Contains(err.Error(), "SECRET") {
		t.Fatal("upstream secret escaped the error boundary")
	}
}

func dataFrame(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return "data: " + string(encoded) + "\n\n"
}

func toolFrame(t *testing.T, index int, id, name, arguments string) string {
	t.Helper()
	return dataFrame(t, map[string]any{"choices": []any{map[string]any{
		"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{
			"index": index, "id": id, "type": "function",
			"function": map[string]string{"name": name, "arguments": arguments},
		}}},
	}}})
}
