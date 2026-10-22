package aiservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/runharness"
)

func providerSSE(t *testing.T, w http.ResponseWriter, body string) {
	t.Helper()
	w.Header().Set("Content-Type", "text/event-stream")
	if _, err := fmt.Fprint(w, body); err != nil {
		return
	}
	w.(http.Flusher).Flush()
}

const providerHelloSSE = "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"}}]}\n\n"
const providerDoneSSE = "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":1,\"total_tokens\":4}}\n\ndata: [DONE]\n\n"

func TestPluginProviderServiceNativeHealthAndFrozenSecrets(t *testing.T) {
	var calls atomic.Int32
	auth := make(chan string, 4) // bounded observations for two model calls
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		auth <- r.Header.Get("Authorization")
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("X-Selected") != "yes" {
			t.Error("wrong projected endpoint/header")
		}
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if strings.Contains(string(body), "unrelated-secret") || strings.Contains(string(body), "secretRef") {
			t.Error("unselected metadata leaked")
		}
		if r.Header.Get("Authorization") != "Bearer selected-test-key" {
			http.Error(w, "fixture credential mismatch", http.StatusUnauthorized)
			return
		}
		providerSSE(t, w, providerHelloSSE+providerDoneSSE)
	}))
	t.Cleanup(upstream.Close)
	fixture := newNativeProviderServiceFixture(t, upstream.URL+"/v1")
	input := runharness.AgentInputRequest{RequestID: "frozen-plugin", Provider: fixture.config.ID, Content: "hello"}
	if err := fixture.service.bindAgentProviderInput(fixture.ctx, &input); err != nil {
		t.Fatal(err)
	}
	binding, ok := input.ProviderBindingForHost()
	if !ok {
		t.Fatal("missing encrypted provider binding")
	}
	var frozen struct {
		MaxTokens int             `json:"maxTokens"`
		Runtime   json.RawMessage `json:"_pluginRuntime"`
	}
	if err := json.Unmarshal(binding.Config, &frozen); err != nil || len(frozen.Runtime) == 0 || frozen.MaxTokens != 0 {
		t.Fatalf("bad frozen limits/pin: %s %v", binding.Config, err)
	}
	fixture.service.mu.Lock()
	fixture.service.providers[0].APIKey = "edited-test-key"
	fixture.service.mu.Unlock()
	instance, err := fixture.service.resolveAgentProvider(fixture.ctx, runharness.ModelTurnRequest{Provider: binding.ProviderID, ProviderBinding: &binding})
	if err != nil {
		t.Fatal(err)
	}
	response, err := instance.Chat(fixture.ctx, ai.ChatRequest{Messages: []ai.Message{{Role: "user", Content: "hello"}}, MaxTokens: 8})
	if err != nil || response.Content != "hello" {
		t.Fatalf("real native HTTP chat: %+v %v", response, err)
	}
	if got := <-auth; got != "Bearer selected-test-key" {
		t.Fatalf("frozen credential changed: %q", got)
	}
	checked := fixture.service.AITestProvider(fixture.config)
	if checked["success"] != true || checked["modelVerified"] != true || checked["checkKind"] != "model-response" || calls.Load() != 2 {
		t.Fatalf("health did not perform real Chat: %+v calls=%d", checked, calls.Load())
	}
	<-auth
	if err := fixture.service.AISaveProvider(fixture.config); err != nil {
		t.Fatal(err)
	}
	draft := cloneAgentProviderConfig(fixture.config)
	draft.APIKey, draft.HasSecret = "", true
	draft.Headers = map[string]string{"X-Selected": "yes", "X-Token": "edited-header"}
	if checked := fixture.service.AITestProvider(draft); checked["success"] != true {
		t.Fatalf("redacted draft health discarded the selected API key: %+v", checked)
	}
	if got := <-auth; got != "Bearer selected-test-key" {
		t.Fatalf("draft selected credential = %q", got)
	}
	if _, err := fixture.manager.SetEnabled(fixture.ctx, "sdk.examples.aiprovider", false); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.service.resolveAgentProvider(fixture.ctx, runharness.ModelTurnRequest{Provider: binding.ProviderID, ProviderBinding: &binding}); err == nil {
		t.Fatal("disabled frozen provider resolved")
	}
	if calls.Load() != 3 {
		t.Fatal("disabled resolve contacted upstream")
	}
	// Re-enable starts a new native process generation; old bindings never rebind.
	if _, err := fixture.manager.SetEnabled(fixture.ctx, "sdk.examples.aiprovider", true); err != nil {
		t.Fatal(err)
	}
	next := runharness.AgentInputRequest{Provider: fixture.config.ID, Content: "new generation"}
	if err := fixture.service.bindAgentProviderInput(fixture.ctx, &next); err != nil {
		t.Fatal(err)
	}
	fresh, ok := next.ProviderBindingForHost()
	if !ok || string(fresh.Config) == string(binding.Config) {
		t.Fatal("new generation did not change frozen pin")
	}
	if _, err := fixture.service.resolveAgentProvider(fixture.ctx, runharness.ModelTurnRequest{Provider: binding.ProviderID, ProviderBinding: &binding}); err == nil {
		t.Fatal("old binding rebound after native process restart")
	}
	if _, err := fixture.service.resolveAgentProvider(fixture.ctx, runharness.ModelTurnRequest{Provider: fresh.ProviderID, ProviderBinding: &fresh}); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 3 {
		t.Fatal("generation validation contacted upstream")
	}
}

func TestPluginProviderServiceNativeStreamEarlyAndCancel(t *testing.T) {
	upstreamCanceled := make(chan struct{})
	release := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		_ = r.Body.Close()
		providerSSE(t, w, providerHelloSSE)
		select {
		case <-r.Context().Done():
			close(upstreamCanceled)
		case <-release:
		}
	}))
	t.Cleanup(upstream.Close)
	t.Cleanup(func() { close(release) })
	fixture := newNativeProviderServiceFixture(t, upstream.URL+"/v1")
	instance, _, err := fixture.service.getActiveProviderRuntimeWithContext(fixture.ctx, ai.ChatSendOptions{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(fixture.ctx)
	defer cancel()
	chunk := make(chan ai.StreamChunk, 2) // first delta and any bounded terminal observation
	result := make(chan error, 1)
	go func() {
		result <- instance.ChatStream(ctx, ai.ChatRequest{Messages: []ai.Message{{Role: "user", Content: "stream"}}, MaxTokens: 8}, func(value ai.StreamChunk) { chunk <- value })
	}()
	select {
	case value := <-chunk:
		if value.Content != "hello" || value.Done {
			t.Fatalf("non-incremental stream: %+v", value)
		}
	case err := <-result:
		t.Fatalf("stream failed before first delta: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("first delta waited for generation completion")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel identity lost: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("stream did not return on cancellation")
	}
	select {
	case <-upstreamCanceled:
	case <-time.After(3 * time.Second):
		t.Fatal("SDK cancellation did not reach HTTP producer")
	}
}

func TestPluginProviderServiceHarnessNeverReplaysFailure(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "HTTP 503 connection reset selected-test-key", http.StatusServiceUnavailable)
	}))
	t.Cleanup(upstream.Close)
	fixture := newNativeProviderServiceFixture(t, upstream.URL+"/v1")
	receipt, err := fixture.service.AISubmitAgentInput(runharness.AgentInputRequest{RequestID: "plugin-no-replay", Provider: fixture.config.ID, Content: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(8 * time.Second)
	defer deadline.Stop()
	for {
		read, err := fixture.service.AIReadAgentRun(runharness.RunReadRequest{RunID: receipt.RunID})
		if err != nil {
			t.Fatal(err)
		}
		if read.Run.State.Terminal() {
			if read.Run.State != runharness.RunStateFailed || calls.Load() != 1 {
				t.Fatalf("unsafe replay/result: state=%s calls=%d", read.Run.State, calls.Load())
			}
			if runharness.IsRetryableModelError(errors.New(read.Run.TerminalReason)) || strings.Contains(read.Run.TerminalReason, "selected-test-key") {
				t.Fatalf("unsafe terminal error: %q", read.Run.TerminalReason)
			}
			return
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatal("provider failure did not settle")
		}
	}
}
