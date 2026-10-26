package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func TestSelectedRequest(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "SECRET-environment-key")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.RequestURI() != "/selected/v1/chat/completions?route=local" {
			t.Errorf("unexpected selected endpoint: %s %s", r.Method, r.URL.RequestURI())
		}
		if r.Header.Get("Authorization") != "Bearer selected-key" || r.Header.Get("X-Selected") != "chosen" || r.Header.Get("User-Agent") != "" {
			t.Error("selected headers were not projected correctly")
		}
		if r.Header.Get("Content-Type") != "application/json" || r.Header.Get("Accept") != "text/event-stream" {
			t.Error("missing HTTP/SSE content negotiation")
		}
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		assertRequestBody(t, body)
		w.Header().Set("Content-Type", "text/event-stream")
		if _, err := io.WriteString(w, stopFrame+doneFrame); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	start := testStart(server.URL + "/selected/v1/?route=local")
	start.Config.APIKey = "selected-key"
	start.Config.Headers = map[string]string{"X-Selected": "chosen"}
	start.Request.Messages[0].ReasoningContent = "prior reasoning"
	request, err := newUpstreamRequest(testContext(t), start)
	if err != nil || request.GetBody != nil {
		t.Fatalf("request is invalid or replayable: %v", err)
	}
	provider := testHTTPProvider(t)
	transport := provider.client.Transport.(*http.Transport)
	if transport.Proxy != nil || transport.ResponseHeaderTimeout <= 0 || transport.ResponseHeaderTimeout > 15*time.Second || transport.TLSHandshakeTimeout <= 0 {
		t.Fatal("transport uses environment proxies or unbounded connection/header timeouts")
	}
	completion, err := provider.generate(testContext(t), start, nil)
	if err != nil || completion.FinishReason != "stop" || completion.Usage != nil {
		t.Fatalf("wrong completion: %+v, %v", completion, err)
	}
}

func assertRequestBody(t *testing.T, body map[string]json.RawMessage) {
	t.Helper()
	expected := map[string]string{
		"model": `"gpt-4o-mini"`, "temperature": "0.2", "max_tokens": "16",
		"n": "1", "stream": "true", "stream_options": `{"include_usage":true}`,
	}
	if len(body) != len(expected)+1 {
		t.Errorf("unexpected request fields: %v", reflect.ValueOf(body).MapKeys())
	}
	for name, value := range expected {
		if string(body[name]) != value {
			t.Errorf("request field %s = %s", name, body[name])
		}
	}
	var messages []map[string]json.RawMessage
	if err := json.Unmarshal(body["messages"], &messages); err != nil || len(messages) != 1 || string(messages[0]["reasoning_content"]) != `"prior reasoning"` {
		t.Error("messages did not preserve snake_case reasoning_content")
	}
}

func TestSelectedToolsAndMessageKeys(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		var messages []map[string]json.RawMessage
		if err := json.Unmarshal(body["messages"], &messages); err != nil || len(messages) != 2 {
			t.Error("missing selected messages")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if string(messages[0]["reasoning_content"]) != `"prior"` || string(messages[1]["tool_call_id"]) != `"history"` || len(messages[0]["tool_calls"]) == 0 {
			t.Error("message keys did not preserve the upstream snake_case contract")
		}
		var tools []plugin.AIProviderTool
		if err := json.Unmarshal(body["tools"], &tools); err != nil || len(tools) != 1 || tools[0].Function.Name != "lookup" || string(tools[0].Function.Parameters) != `{"type":"object"}` {
			t.Error("selected tool definition was not forwarded")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if _, err := io.WriteString(w, stopFrame+doneFrame); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	start := testStart(server.URL)
	start.Request.Messages = []plugin.AIProviderMessage{
		{Role: "assistant", ReasoningContent: "prior", ToolCalls: []plugin.AIProviderToolCall{{
			ID: "history", Type: "function", Function: plugin.AIProviderToolCallFunction{Name: "lookup", Arguments: `{}`},
		}}},
		{Role: "tool", Content: "prior-result", ToolCallID: "history"},
	}
	start.Request.Tools = []plugin.AIProviderTool{{Type: "function", Function: plugin.AIProviderToolFunction{
		Name: "lookup", Parameters: json.RawMessage(`{"type":"object"}`),
	}}}
	if _, err := testHTTPProvider(t).generate(testContext(t), start, nil); err != nil {
		t.Fatal(err)
	}
}

func TestCompletionURL(t *testing.T) {
	for _, test := range []struct{ base, want string }{
		{"http://localhost/v1/", "http://localhost/v1/chat/completions"},
		{"https://localhost/custom%2Fbase", "https://localhost/custom%2Fbase/chat/completions"},
		{"", ""}, {"/v1", ""}, {"ftp://localhost", ""},
		{"https://user:SECRET@localhost", ""}, {"https://localhost/#SECRET", ""},
	} {
		t.Run(test.base, func(t *testing.T) {
			got, err := completionURL(test.base)
			if test.want == "" {
				assertFailure(t, err, "invalid_request")
				return
			}
			if err != nil || got != test.want {
				t.Fatalf("endpoint = %q, %v", got, err)
			}
		})
	}
}

func TestRedirectAndHTTPFailuresAreSafe(t *testing.T) {
	var leakedRequests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		leakedRequests.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()
	for _, status := range []int{301, 302, 307, 308, 401, 429, 500, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				requests.Add(1)
				w.Header().Set("Location", target.URL+"/SECRET-location")
				w.WriteHeader(status)
				if _, err := io.WriteString(w, "SECRET-upstream-error-key-and-message"); err != nil {
					t.Error(err)
				}
			}))
			defer server.Close()
			start := testStart(server.URL)
			start.Config.APIKey = "SECRET-selected-key"
			_, err := testHTTPProvider(t).generate(testContext(t), start, nil)
			assertFailure(t, err, "generation_failed")
			if requests.Load() != 1 || leakedRequests.Load() != 0 {
				t.Fatal("request was retried or redirected")
			}
		})
	}
}
