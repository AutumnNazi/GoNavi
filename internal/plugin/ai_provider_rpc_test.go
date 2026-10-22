package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func aiRPCFixture() *rpcProcess {
	return &rpcProcess{pending: make(map[uint64]rpcPending), failed: make(chan struct{}), outgoing: make(chan []byte, 64)}
}

func aiRPCRequestID(t *testing.T, p *rpcProcess) uint64 {
	t.Helper()
	select {
	case frame := <-p.outgoing:
		var request struct {
			ID uint64 `json:"id"`
		}
		if err := json.Unmarshal(frame, &request); err != nil {
			t.Fatal(err)
		}
		return request.ID
	case <-time.After(time.Second):
		t.Fatal("request not dispatched")
		return 0
	}
}

func TestAIRequestPolicyWidensOnlyOptedInFrames(t *testing.T) {
	large := strings.Repeat("x", maxRPCBytes+1024)
	p := aiRPCFixture()
	defer p.fail(errors.New("test cleanup"))
	if _, err := p.callBounded(context.Background(), "plugin.invoke", large, rpcCallPolicy{maxResponseBytes: 256}); err == nil {
		t.Fatal("ordinary frame limit relaxed")
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := p.callBounded(ctx, "plugin.invoke", large, rpcCallPolicy{maxRequestBytes: maxAIProviderRequestBytes, maxResponseBytes: 256})
		done <- err
	}()
	aiRPCRequestID(t, p)
	cancel()
	if !errors.Is(<-done, context.Canceled) {
		t.Fatal("bounded ai image request was not dispatched")
	}
}

func TestAIResponseCreditSurvivesCallerCancellation(t *testing.T) {
	for _, oversized := range []bool{false, true} {
		t.Run(map[bool]string{false: "valid late reply", true: "oversized late reply"}[oversized], func(t *testing.T) {
			p := aiRPCFixture()
			defer p.fail(errors.New("test cleanup"))
			var released atomic.Int32
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1) // One caller result must be collectable after cancellation.
			go func() {
				_, err := p.callBounded(ctx, "plugin.invoke", map[string]bool{"ok": true}, rpcCallPolicy{maxResponseBytes: 256, settled: func() { released.Add(1) }})
				done <- err
			}()
			id := aiRPCRequestID(t, p)
			cancel()
			if err := <-done; !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
			p.mu.Lock()
			pending := len(p.pending)
			p.mu.Unlock()
			if pending != 1 || released.Load() != 0 {
				t.Fatal("caller cancellation released unsettled credit")
			}
			result := json.RawMessage(`{}`)
			if oversized {
				result = json.RawMessage(`"` + strings.Repeat("x", 300) + `"`)
			}
			frame, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
			if err != nil {
				t.Fatal(err)
			}
			err = p.receive(frame)
			if oversized {
				if err == nil || released.Load() != 0 {
					t.Fatal("oversized late reply settled")
				}
				p.fail(err)
			} else if err != nil {
				t.Fatal(err)
			}
			if released.Load() != 1 {
				t.Fatalf("settlement count=%d", released.Load())
			}
			p.fail(errors.New("second failure"))
			if released.Load() != 1 {
				t.Fatal("terminal released twice")
			}
		})
	}
}

func TestAIDefinitelyUnsentSettlesExactlyOnce(t *testing.T) {
	for _, kind := range []string{"canceled", "terminal", "pending full", "queue full", "marshal", "oversized"} {
		t.Run(kind, func(t *testing.T) {
			p := aiRPCFixture()
			var released atomic.Int32
			ctx := context.Background()
			var params any = map[string]bool{"ok": true}
			switch kind {
			case "canceled":
				canceled, cancel := context.WithCancel(ctx)
				cancel()
				ctx = canceled
			case "terminal":
				p.fail(errors.New("closed"))
			case "pending full":
				for id := uint64(1); id <= maxPendingRPC; id++ {
					p.pending[id] = rpcPending{reply: make(chan rpcResult, 1)}
				}
			case "queue full":
				for i := 0; i < cap(p.outgoing); i++ {
					p.outgoing <- []byte("occupied")
				}
			case "marshal":
				params = make(chan int)
			case "oversized":
				params = strings.Repeat("x", maxRPCBytes+1)
			}
			if _, err := p.callBounded(ctx, "plugin.invoke", params, rpcCallPolicy{maxResponseBytes: 256, settled: func() { released.Add(1) }}); err == nil {
				t.Fatal("unsent request unexpectedly succeeded")
			}
			if released.Load() != 1 {
				t.Fatalf("unsent settlement=%d", released.Load())
			}
			p.fail(errors.New("cleanup"))
			if released.Load() != 1 {
				t.Fatal("unsent released twice")
			}
		})
	}
}

func TestAIOptionalRPCPolicyPreservesOrdinaryCancellation(t *testing.T) {
	p := aiRPCFixture()
	defer p.fail(errors.New("cleanup"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1) // Ordinary RPC still reserves its response after cancellation.
	go func() { _, err := p.call(ctx, "plugin.invoke", struct{}{}); done <- err }()
	id := aiRPCRequestID(t, p)
	cancel()
	if !errors.Is(<-done, context.Canceled) {
		t.Fatal("ordinary cancellation changed")
	}
	p.mu.Lock()
	_, retained := p.pending[id]
	p.mu.Unlock()
	if !retained {
		t.Fatal("ordinary cancellation no longer retains its pending response")
	}
	frame, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "result": strings.Repeat("x", 2048)})
	if err != nil {
		t.Fatal(err)
	}
	if err = p.receive(frame); err != nil {
		t.Fatalf("AI response cap leaked into ordinary RPC: %v", err)
	}
}
