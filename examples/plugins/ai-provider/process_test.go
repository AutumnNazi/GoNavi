package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

type processUpstream struct {
	finish           chan struct{}
	cancelStarted    chan struct{}
	cancelObserved   chan struct{}
	shutdownStarted  chan struct{}
	shutdownObserved chan struct{}
	requests         atomic.Int32
}

func (u *processUpstream) serve(t *testing.T, w http.ResponseWriter, r *http.Request) {
	t.Helper()
	u.requests.Add(1)
	if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer SECRET-process-selected" {
		t.Error("subprocess did not use selected HTTP configuration")
	}
	var body upstreamRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Messages) != 1 {
		t.Error("invalid subprocess HTTP request")
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	drainRequest(t, r)
	w.Header().Set("Content-Type", "text/event-stream")
	mode := body.Messages[0].Content
	if mode == "cancel" || mode == "shutdown" {
		w.(http.Flusher).Flush()
		started, observed := u.cancelStarted, u.cancelObserved
		if mode == "shutdown" {
			started, observed = u.shutdownStarted, u.shutdownObserved
		}
		close(started)
		<-r.Context().Done()
		close(observed)
		return
	}
	first := "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"first-local\",\"reasoning_content\":\"reason-local\"}}]}\n\n"
	first += toolFrame(t, 0, "call_", "loo", `{"id":`)
	if _, err := io.WriteString(w, first); err != nil {
		t.Error(err)
		return
	}
	w.(http.Flusher).Flush()
	select {
	case <-u.finish:
	case <-r.Context().Done():
		return
	}
	last := toolFrame(t, 0, "1", "kup", `42}`) + strings.ReplaceAll(stopFrame, "stop", "tool_calls")
	last += "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":1,\"total_tokens\":3}}\n\n" + doneFrame
	if _, err := io.WriteString(w, last); err != nil {
		t.Error(err)
	}
}

func TestIndependentProviderProcess(t *testing.T) {
	binary := buildIndependentProcess(t)
	u := &processUpstream{
		finish: make(chan struct{}), cancelStarted: make(chan struct{}), cancelObserved: make(chan struct{}),
		shutdownStarted: make(chan struct{}), shutdownObserved: make(chan struct{}),
	}
	unblock := sync.OnceFunc(func() { close(u.finish) })
	defer unblock()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { u.serve(t, w, r) }))
	t.Cleanup(server.Close)
	process := startIndependentProcess(t, binary)
	start := testStart(server.URL + "/v1")
	start.Config.APIKey = "SECRET-process-selected"
	start.Request.Tools = []plugin.AIProviderTool{{Type: "function", Function: plugin.AIProviderToolFunction{
		Name: "lookup", Parameters: json.RawMessage(`{"type":"object"}`),
	}}}
	process.invoke(t, "start", start.RequestID, &start, false)
	events := process.pull(t, start.RequestID)
	if len(events) != 1 || events[0].Sequence != 1 || events[0].Type != "delta" || events[0].Content != "first-local" || events[0].ReasoningContent != "reason-local" || len(events[0].ToolCalls) != 0 {
		t.Fatalf("early pull did not yield incremental text only: %+v", events)
	}
	unblock()
	terminal := processTerminal(t, process, start.RequestID, 1)
	if terminal.Type != "done" || terminal.FinishReason != "tool_calls" || len(terminal.ToolCalls) != 1 || terminal.ToolCalls[0].Function.Name != "lookup" || terminal.ToolCalls[0].Function.Arguments != `{"id":42}` || terminal.Usage == nil || terminal.Usage.TotalTokens != 3 {
		t.Fatalf("wrong terminal snapshot: %+v", terminal)
	}
	start.RequestID = newRequestID(t)
	start.Request.Messages[0].Content = "cancel"
	process.invoke(t, "start", start.RequestID, &start, false)
	awaitSignal(t, u.cancelStarted)
	process.invoke(t, "cancel", start.RequestID, nil, false)
	awaitSignal(t, u.cancelObserved)
	reply := process.invoke(t, "pull", start.RequestID, nil, true)
	if reply.Error.Message != "canceled" {
		t.Fatal("cancellation did not discard buffered output")
	}
	process.invoke(t, "start", start.RequestID, &start, true)
	start.RequestID = newRequestID(t)
	start.Request.Messages[0].Content = "shutdown"
	process.invoke(t, "start", start.RequestID, &start, false)
	awaitSignal(t, u.shutdownStarted)
	process.rpc(t, "plugin.shutdown", map[string]any{}, false)
	awaitSignal(t, u.shutdownObserved)
	process.wait(t)
	if u.requests.Load() != 3 {
		t.Fatalf("unexpected retries or network discovery: %d requests", u.requests.Load())
	}
}

func processTerminal(t *testing.T, process *providerProcess, requestID string, sequence uint64) plugin.AIProviderEvent {
	t.Helper()
	for attempt := 0; attempt < 10; attempt++ {
		events := process.pull(t, requestID)
		for index, event := range events {
			sequence++
			if event.Sequence != sequence {
				t.Fatal("noncontiguous pull sequence")
			}
			if event.Type == "done" || event.Type == "error" {
				if index != len(events)-1 {
					t.Fatal("events followed the terminal snapshot")
				}
				return event
			}
			if event.Type != "delta" || len(event.ToolCalls) > 0 {
				t.Fatal("tool snapshot escaped before terminal")
			}
		}
	}
	t.Fatal("missing terminal event")
	return plugin.AIProviderEvent{}
}

func awaitSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(3 * time.Second):
		t.Fatal("local upstream lifecycle did not progress")
	}
}
