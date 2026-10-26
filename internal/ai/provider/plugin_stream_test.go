package provider

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/plugin"
)

func pluginStreamFixture() *pluginProvider {
	c := pluginTestConfig()
	c.ContextWindow = 4096
	return &pluginProvider{config: c, pin: pluginProviderPin{PluginID: "test.models", ProviderID: "chat", Generation: 1, Digest: strings.Repeat("a", 64)}, declaration: plugin.AIProvider{ID: "chat", SupportsTools: true, Models: []plugin.AIModel{{ID: "model-1", ContextWindow: 4096, MaxOutputTokens: 128}}}, check: func(ctx context.Context) error { return ctx.Err() }}
}
func pluginStreamRequest() ai.ChatRequest {
	return ai.ChatRequest{Messages: []ai.Message{{Role: "user", Content: "hello"}}}
}
func pluginOperation(t *testing.T, raw json.RawMessage) pluginRequestEnvelope {
	t.Helper()
	var req pluginRequestEnvelope
	if json.Unmarshal(raw, &req) != nil {
		t.Fatal("invalid request")
	}
	if req.ProviderID != "chat" || len(req.RequestID) != 43 {
		t.Error("missing provider-bound completion identity")
	}
	return req
}
func TestPluginStreamIsIncrementalAndCancelStopsBlockedConsumer(t *testing.T) {
	p := pluginStreamFixture()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered := make(chan struct{})
	release := make(chan struct{})
	remoteCanceled := make(chan struct{})
	var cancels atomic.Int32
	p.invoke = func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		switch pluginOperation(t, raw).Operation {
		case "start":
			return json.RawMessage(`{"accepted":true}`), nil
		case "pull":
			return json.RawMessage(`{"events":[{"sequence":1,"type":"delta","content":"early"}]}`), nil
		case "cancel":
			if cancels.Add(1) == 1 {
				close(remoteCanceled)
			}
			return json.RawMessage(`{"ok":true}`), nil
		}
		return nil, errors.New("bad operation")
	}
	done := make(chan error, 1)
	go func() {
		done <- p.ChatStream(ctx, pluginStreamRequest(), func(chunk ai.StreamChunk) {
			if chunk.Content != "early" {
				t.Error("wrong delta")
			}
			close(entered)
			<-release
		})
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("delta was not delivered incrementally")
	}
	cancel()
	select {
	case <-remoteCanceled:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("blocked consumer prevented upstream cancel")
	}
	select {
	case <-done:
		t.Fatal("returned while callback still running")
	default:
	}
	close(release)
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("wrong cancellation: %v", err)
	}
	if cancels.Load() != 1 {
		t.Fatal("cleanup replayed")
	}
}
func TestPluginStreamUnknownOutcomeNeverReturnsPartialSuccessOrLeaksCause(t *testing.T) {
	for _, failure := range []error{io.EOF, errors.New("HTTP 503 secret-key connection reset")} {
		p := pluginStreamFixture()
		calls, cancels := 0, 0
		p.invoke = func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
			switch pluginOperation(t, raw).Operation {
			case "start":
				return json.RawMessage(`{"accepted":true}`), nil
			case "cancel":
				cancels++
				return json.RawMessage(`{"ok":true}`), nil
			}
			calls++
			if calls == 1 {
				return json.RawMessage(`{"events":[{"sequence":1,"type":"delta","content":"partial"}]}`), nil
			}
			return nil, failure
		}
		result, err := p.Chat(context.Background(), pluginStreamRequest())
		if result != nil || err != ErrPluginProviderOperation || errors.Is(err, failure) || calls != 2 || cancels != 1 {
			t.Fatalf("ambiguous completion mishandled: result=%v err=%v calls=%d cleanup=%d", result, err, calls, cancels)
		}
	}
}
func TestPluginStreamLengthIsExplicitKnownPartialOutput(t *testing.T) {
	for _, report := range []bool{false, true} {
		p := pluginStreamFixture()
		p.invoke = func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
			switch pluginOperation(t, raw).Operation {
			case "start":
				return json.RawMessage(`{"accepted":true}`), nil
			case "cancel":
				return json.RawMessage(`{"ok":true}`), nil
			}
			return json.RawMessage(`{"events":[{"sequence":1,"type":"delta","content":"known partial"},{"sequence":2,"type":"done","finishReason":"length"}]}`), nil
		}
		req := pluginStreamRequest()
		req.ReportOutputLimit = report
		result, err := p.Chat(context.Background(), req)
		var limit *ai.OutputLimitError
		if result == nil || result.Content != "known partial" || errors.As(err, &limit) != report || (!report && err != nil) {
			t.Fatalf("output limit semantics changed: %v %v", result, err)
		}
	}
}
func TestPluginStreamFailedStartStillCancelsOnce(t *testing.T) {
	p := pluginStreamFixture()
	starts, cancels := 0, 0
	p.invoke = func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		if pluginOperation(t, raw).Operation == "cancel" {
			cancels++
			return json.RawMessage(`{"ok":true}`), nil
		}
		starts++
		return nil, io.ErrUnexpectedEOF
	}
	if _, err := p.Chat(context.Background(), pluginStreamRequest()); err != ErrPluginProviderOperation || starts != 1 || cancels != 1 {
		t.Fatalf("failed start replay/cleanup: %v %d %d", err, starts, cancels)
	}
}
