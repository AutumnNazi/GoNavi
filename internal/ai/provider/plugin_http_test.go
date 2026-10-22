package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/plugin"
)

func pluginSSE(w http.ResponseWriter, value any) {
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "data: %s\n\n", data)
	w.(http.Flusher).Flush()
}
func pluginSSEChoice(w http.ResponseWriter, delta map[string]any, finish any) {
	pluginSSE(w, map[string]any{"choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}})
}
func pluginSSEDone(w http.ResponseWriter) {
	fmt.Fprint(w, "data: [DONE]\n\n")
	w.(http.Flusher).Flush()
}

func TestPluginHTTPRealSDKSubprocess(t *testing.T) {
	incrementalRelease := make(chan struct{})
	cancelObserved := make(chan struct{})
	concurrentRelease := make(chan struct{})
	entered := make(chan struct{}, 16) // One bounded signal per admitted test worker.
	var releaseIncremental, releaseConcurrent sync.Once
	var failures atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer LOCAL_FIXTURE_KEY" || r.Header.Get("X-Selected") != "fixture" {
			t.Error("selected secrets not forwarded")
		}
		var input map[string]json.RawMessage
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			t.Error("invalid upstream request")
		}
		if string(input["model"]) != `"gpt-4o-mini"` || string(input["max_tokens"]) != "16384" {
			t.Error("wrong declared model/effective cap")
		}
		if strings.Contains(r.URL.Path, "failure") {
			failures.Add(1)
			http.Error(w, "HTTP 503 LOCAL_FIXTURE_KEY", 503)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		switch {
		case strings.Contains(r.URL.Path, "incremental"):
			pluginSSEChoice(w, map[string]any{"content": "first", "reasoning_content": "thought"}, nil)
			select {
			case <-incrementalRelease:
			case <-r.Context().Done():
				return
			}
			pluginSSEChoice(w, map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "call-1", "type": "function", "function": map[string]any{"name": "inspect", "arguments": "{}"}}}}, "tool_calls")
			pluginSSE(w, map[string]any{"choices": []any{}, "usage": map[string]any{"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5, "prompt_tokens_details": map[string]any{"cached_tokens": 0}}})
			pluginSSEDone(w)
		case strings.Contains(r.URL.Path, "cancel"):
			pluginSSEChoice(w, map[string]any{"content": "before cancel"}, nil)
			<-r.Context().Done()
			close(cancelObserved)
		case strings.Contains(r.URL.Path, "concurrent"):
			w.(http.Flusher).Flush()
			entered <- struct{}{}
			select {
			case <-concurrentRelease:
			case <-r.Context().Done():
				return
			}
			pluginSSEChoice(w, map[string]any{"content": "complete"}, "stop")
			pluginSSEDone(w)
		default:
			pluginSSEChoice(w, map[string]any{"content": "partial"}, nil)
		}
	}))
	t.Cleanup(server.Close)
	manager, factory := pluginHTTPFixture(t)
	t.Cleanup(func() {
		releaseIncremental.Do(func() { close(incrementalRelease) })
		releaseConcurrent.Do(func() { close(concurrentRelease) })
	})
	h := &pluginHTTPCase{factory: factory, manager: manager, server: server, releaseIncremental: &releaseIncremental, incrementalRelease: incrementalRelease, cancelObserved: cancelObserved, concurrentRelease: concurrentRelease, entered: entered, releaseConcurrent: &releaseConcurrent, failures: &failures}
	t.Run("incremental tools usage", func(t *testing.T) { pluginHTTPIncremental(t, h) })
	t.Run("blocked callback cancellation", func(t *testing.T) { pluginHTTPCancel(t, h) })
	t.Run("ambiguous failure no replay", func(t *testing.T) { pluginHTTPFailure(t, h) })
	t.Run("missing terminal", func(t *testing.T) { pluginHTTPEOF(t, h) })
	t.Run("sixteen empty long polls", func(t *testing.T) { pluginHTTPConcurrent(t, h) })
}

type pluginHTTPCase struct {
	factory                                                        *PluginFactory
	manager                                                        *plugin.Manager
	server                                                         *httptest.Server
	releaseIncremental, releaseConcurrent                          *sync.Once
	incrementalRelease, cancelObserved, concurrentRelease, entered chan struct{}
	failures                                                       *atomic.Int32
}

func pluginHTTPIncremental(t *testing.T, h *pluginHTTPCase) {
	p, err := h.factory.New(context.Background(), pluginHTTPConfig(h.server.URL+"/incremental"))
	if err != nil {
		t.Fatal(err)
	}
	req := pluginStreamRequest()
	req.Tools = []ai.Tool{{Type: "function", Function: ai.ToolFunction{Name: "inspect", Parameters: map[string]any{"type": "object"}}}}
	first := make(chan struct{})
	result := make(chan error, 1)
	var chunks []ai.StreamChunk
	go func() {
		result <- p.ChatStream(context.Background(), req, func(c ai.StreamChunk) {
			chunks = append(chunks, c)
			if c.Content == "first" {
				close(first)
			}
		})
	}()
	select {
	case <-first:
	case err := <-result:
		t.Fatalf("stream ended before first chunk: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("SDK buffered entire upstream response")
	}
	h.releaseIncremental.Do(func() { close(h.incrementalRelease) })
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	last := chunks[len(chunks)-1]
	if !last.Done || len(last.ToolCalls) != 1 || last.ToolCalls[0].Function.Arguments != "{}" || last.Usage == nil || last.Usage.TotalTokens != 5 || last.Usage.CachedTokens == nil || chunks[0].ReasoningContent != "thought" {
		t.Fatal("terminal snapshot/reasoning/usage mismatch")
	}
}

func pluginHTTPCancel(t *testing.T, h *pluginHTTPCase) {
	p, err := h.factory.New(context.Background(), pluginHTTPConfig(h.server.URL+"/cancel"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	blocked, release := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- p.ChatStream(ctx, pluginStreamRequest(), func(ai.StreamChunk) { close(blocked); <-release })
	}()
	select {
	case <-blocked:
	case <-time.After(3 * time.Second):
		t.Fatal("no incremental cancellation chunk")
	}
	cancel()
	select {
	case <-h.cancelObserved:
	case <-time.After(2 * time.Second):
		close(release)
		t.Fatal("upstream survived blocked callback cancellation")
	}
	close(release)
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func pluginHTTPFailure(t *testing.T, h *pluginHTTPCase) {
	p, err := h.factory.New(context.Background(), pluginHTTPConfig(h.server.URL+"/failure"))
	if err != nil {
		t.Fatal(err)
	}
	result, err := p.Chat(context.Background(), pluginStreamRequest())
	if result != nil || err != ErrPluginProviderOperation || h.failures.Load() != 1 {
		t.Fatalf("failure disclosed/replayed: %v requests=%d", err, h.failures.Load())
	}
}

func pluginHTTPEOF(t *testing.T, h *pluginHTTPCase) {
	p, err := h.factory.New(context.Background(), pluginHTTPConfig(h.server.URL+"/eof"))
	if err != nil {
		t.Fatal(err)
	}
	if result, err := p.Chat(context.Background(), pluginStreamRequest()); result != nil || err == nil {
		t.Fatal("EOF partial text reported success")
	}
}

func pluginHTTPConcurrent(t *testing.T, h *pluginHTTPCase) {
	p, err := h.factory.New(context.Background(), pluginHTTPConfig(h.server.URL+"/concurrent"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	done := make(chan error, 16) // All producers can deliver completion during cancellation.
	var workers sync.WaitGroup
	workers.Add(16)
	defer func() { cancel(); h.releaseConcurrent.Do(func() { close(h.concurrentRelease) }); workers.Wait() }()
	for i := 0; i < 16; i++ {
		go func() { defer workers.Done(); _, err := p.Chat(ctx, pluginStreamRequest()); done <- err }()
	}
	for i := 0; i < 16; i++ {
		select {
		case <-h.entered:
		case err := <-done:
			t.Fatalf("early concurrent failure: %v", err)
		case <-ctx.Done():
			t.Fatal("concurrent upstream admission stalled")
		}
	}
	timer := time.NewTimer(8 * time.Second)
	defer timer.Stop()
	select {
	case <-timer.C:
	case err := <-done:
		t.Fatalf("empty pulls timed out: %v", err)
	}
	h.releaseConcurrent.Do(func() { close(h.concurrentRelease) })
	for i := 0; i < 16; i++ {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	if status := h.manager.List()[0]; status.State != plugin.StateRunning {
		t.Fatalf("legitimate pulls isolated runtime: %s", status.State)
	}
}
