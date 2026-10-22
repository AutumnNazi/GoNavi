package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func TestDeltaArrivesBeforeUpstreamFinishes(t *testing.T) {
	release := make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	defer unblock()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		drainRequest(t, r)
		w.Header().Set("Content-Type", "text/event-stream")
		if _, err := io.WriteString(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"first\",\"reasoning_content\":\"thinking\"}}]}\n\n"); err != nil {
			t.Error(err)
			return
		}
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
			return
		case <-release:
		}
		if _, err := io.WriteString(w, stopFrame+doneFrame); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// Each channel holds the single result from one joined generation worker.
	delivered := make(chan plugin.AIProviderDelta, 1)
	finished := make(chan error, 1)
	provider := testHTTPProvider(t)
	go func() {
		_, err := provider.generate(ctx, testStart(server.URL), func(delta plugin.AIProviderDelta) error {
			delivered <- delta
			return nil
		})
		finished <- err
	}()
	select {
	case delta := <-delivered:
		if delta.Content != "first" || delta.ReasoningContent != "thinking" {
			t.Fatalf("wrong incremental delta: %+v", delta)
		}
	case <-ctx.Done():
		t.Fatal("first delta was buffered until upstream completion")
	}
	select {
	case err := <-finished:
		t.Fatalf("generation completed while upstream was blocked: %v", err)
	default:
	}
	unblock()
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
}

func TestReasoningToolsUsageAndLength(t *testing.T) {
	for _, finish := range []string{"tool_calls", "length"} {
		t.Run(finish, func(t *testing.T) {
			body := "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\"}}]}\n\n" +
				"data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"reason\"}}]}\n\n" +
				toolFrame(t, 0, "call_", "loo", `{"id":`) + toolFrame(t, 0, "1", "kup", `42}`) +
				dataFrame(t, map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": finish}}}) +
				"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":3,\"total_tokens\":10,\"prompt_tokens_details\":{\"cached_tokens\":2}}}\n\n" + doneFrame
			completion, deltas, err := collectSSE(t, body)
			if err != nil || completion.FinishReason != finish || len(deltas) != 1 || deltas[0].ReasoningContent != "reason" {
				t.Fatalf("wrong stream: %+v %+v %v", completion, deltas, err)
			}
			if len(completion.ToolCalls) != 1 || completion.ToolCalls[0].ID != "call_1" || completion.ToolCalls[0].Type != "function" || completion.ToolCalls[0].Function.Name != "lookup" || completion.ToolCalls[0].Function.Arguments != `{"id":42}` {
				t.Fatalf("incomplete tools: %+v", completion.ToolCalls)
			}
			usage := completion.Usage
			if usage == nil || usage.PromptTokens != 7 || usage.CompletionTokens != 3 || usage.TotalTokens != 10 || usage.CachedTokens == nil || *usage.CachedTokens != 2 {
				t.Fatalf("incorrect usage: %+v", usage)
			}
		})
	}
}

func TestMalformedStreamsCannotSucceed(t *testing.T) {
	for _, test := range []struct{ name, body string }{
		{"empty EOF", ""}, {"finish without DONE", stopFrame}, {"DONE without finish", doneFrame},
		{"text without finish", "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"}}]}\n\n"},
		{"duplicate finish", stopFrame + stopFrame + doneFrame},
		{"duplicate DONE", stopFrame + doneFrame + doneFrame},
		{"data after finish", stopFrame + "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"late\"}}]}\n\n" + doneFrame},
		{"trailing data", stopFrame + doneFrame + "data: SECRET-trailing\n\n"},
		{"trailing unknown field", stopFrame + doneFrame + "SECRET-trailing\n\n"},
		{"unterminated event", stopFrame + "data: [DONE]\n"},
		{"unterminated line", stopFrame + "data: [DONE]"},
		{"bad JSON", "data: {SECRET-invalid}\n\n"},
		{"upstream error", "data: {\"error\":{\"code\":\"SECRET-code\",\"message\":\"SECRET-message\"}}\n\n"},
		{"wrong choice", "data: {\"choices\":[{\"index\":1,\"delta\":{}}]}\n\n" + stopFrame + doneFrame},
		{"missing choice index", "data: {\"choices\":[{\"delta\":{}}]}\n\n" + stopFrame + doneFrame},
		{"multiple choices", "data: {\"choices\":[{\"index\":0,\"delta\":{}},{\"index\":1,\"delta\":{}}]}\n\n" + stopFrame + doneFrame},
		{"bad finish", strings.ReplaceAll(stopFrame, "stop", "SECRET-finish") + doneFrame},
		{"duplicate finish key", "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\",\"finish_reason\":\"length\"}]}\n\n" + doneFrame},
		{"invalid UTF8", "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"\xff\"}}]}\n\n" + stopFrame + doneFrame},
		{"unpaired high surrogate", "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"\\ud800\"}}]}\n\n" + stopFrame + doneFrame},
		{"unpaired low surrogate", "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"\\udfff\"}}]}\n\n" + stopFrame + doneFrame},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, _, err := collectSSE(t, test.body)
			assertFailure(t, err, "generation_failed")
		})
	}
}

func TestValidEscapedSurrogatePair(t *testing.T) {
	body := "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"\\ud83d\\ude00\"}}]}\n\n" + stopFrame + doneFrame
	_, deltas, err := collectSSE(t, body)
	if err != nil || len(deltas) != 1 || deltas[0].Content != "😀" {
		t.Fatalf("valid surrogate pair was rejected: %+v %v", deltas, err)
	}
}

func TestSSEMultilineAndLineEndings(t *testing.T) {
	for _, ending := range []string{"\n", "\r\n", "\r"} {
		t.Run(jsonString(t, ending), func(t *testing.T) {
			body := "\xef\xbb\xbf: local keepalive\nid: ignored\nevent: message\ndata: {\"id\":\"ignored\",\"created\":0,\"model\":\"ignored\",\ndata: \"choices\":[{\"index\":0,\"delta\":{\"content\":\"local\"}}]}\n\n" + stopFrame + doneFrame
			completion, deltas, err := collectSSE(t, strings.ReplaceAll(body, "\n", ending))
			if err != nil || completion.FinishReason != "stop" || len(deltas) != 1 || deltas[0].Content != "local" {
				t.Fatalf("SSE lines not parsed: %+v %+v %v", completion, deltas, err)
			}
		})
	}
}

func jsonString(t *testing.T, value string) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}
