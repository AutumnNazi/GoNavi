package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

func aiArguments(operation, provider string) json.RawMessage {
	value := map[string]any{"protocolVersion": 1, "operation": operation, "providerId": provider, "requestId": strings.Repeat("a", 43)}
	if operation == "start" {
		value["config"] = map[string]any{"model": "model/A:1+v@x"}
		value["request"] = map[string]any{"messages": []any{}}
	}
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return raw
}

func runningAIProvider(t *testing.T, mode string) (*Manager, Status) {
	t.Helper()
	manager := managerAt(t, t.TempDir())
	manager.opts.MaxConcurrentInvocations = 16
	status := installAIProviderFixture(t, manager, mode)
	enableFixture(t, manager, status.Manifest.ID)
	if err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	status = waitState(t, manager, status.Manifest.ID, StateRunning)
	waitFor(t, "AI instance ready", func() bool {
		manager.mu.Lock()
		defer manager.mu.Unlock()
		return manager.instances[status.Manifest.ID].ready
	})
	return manager, status
}

func TestAIPrivateInvocationReservesGenericAndFencesBinding(t *testing.T) {
	manager, status := runningAIProvider(t, "normal")
	ctx := context.Background()
	args := aiArguments("start", "first")
	if _, err := manager.Invoke(ctx, status.Manifest.ID, "generate", args); !errors.Is(err, ErrAIProviderCommandReserved) {
		t.Fatalf("generic bypass: %v", err)
	}
	if _, err := manager.InvokeGeneration(ctx, status.Manifest.ID, status.Generation, "generate", args); !errors.Is(err, ErrAIProviderCommandReserved) {
		t.Fatalf("generation generic bypass: %v", err)
	}
	if result, err := manager.Invoke(ctx, status.Manifest.ID, "ordinary", json.RawMessage(`{"ordinary":true}`)); err != nil || string(result) != `{"ordinary":true}` {
		t.Fatalf("ordinary behavior: %s %v", result, err)
	}
	if _, err := manager.InvokeAIProviderGeneration(ctx, status.Manifest.ID, status.Generation, "first", status.Digest, args); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.InvokeAIProviderGeneration(ctx, status.Manifest.ID, status.Generation, "second", status.Digest, args); err == nil {
		t.Fatal("cross-provider envelope accepted")
	}
	if _, err := manager.InvokeAIProviderGeneration(ctx, status.Manifest.ID, status.Generation, "first", strings.Repeat("f", 64), args); !errors.Is(err, ErrDigestMismatch) {
		t.Fatalf("digest fence: %v", err)
	}
	observer := managerAt(t, manager.root)
	if _, err := observer.InvokeAIProviderGeneration(ctx, status.Manifest.ID, status.Generation, "first", status.Digest, args); !errors.Is(err, ErrDisabled) {
		t.Fatalf("non-owner invoked: %v", err)
	}
	if _, err := manager.SetEnabled(ctx, status.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.InvokeAIProviderGeneration(ctx, status.Manifest.ID, status.Generation, "first", status.Digest, args); !errors.Is(err, ErrDisabled) {
		t.Fatalf("disabled generation: %v", err)
	}
	enableFixture(t, manager, status.Manifest.ID)
	fresh := waitState(t, manager, status.Manifest.ID, StateRunning)
	if _, err := manager.InvokeAIProviderGeneration(ctx, status.Manifest.ID, status.Generation, "first", status.Digest, args); !errors.Is(err, ErrDisabled) {
		t.Fatal("old generation rebound")
	}
	if _, err := manager.InvokeAIProviderGeneration(ctx, status.Manifest.ID, fresh.Generation, "first", fresh.Digest, args); err != nil {
		t.Fatal(err)
	}
}

func TestAIQueuedCallerDeadlineDoesNotQuarantineHealthyProcess(t *testing.T) {
	manager, status := runningAIProvider(t, "delay")
	manager.mu.Lock()
	instance := manager.instances[status.Manifest.ID]
	manager.mu.Unlock()
	var credits []*aiReplyCredit
	for i := 0; i < 6; i++ {
		credit, err := instance.aiTraffic.acquire(context.Background(), aiPullReplyBytes, false)
		if err != nil {
			t.Fatal(err)
		}
		credits = append(credits, credit)
	}
	defer func() {
		for _, credit := range credits {
			credit.release()
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := manager.InvokeAIProviderGeneration(ctx, status.Manifest.ID, status.Generation, "first", status.Digest, aiArguments("pull", "first"))
		done <- err
	}()
	timer := time.NewTimer(200 * time.Millisecond)
	<-timer.C
	timer.Stop()
	credits[0].release()
	if err := <-done; !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("caller budget expected: %v", err)
	}
	waitFor(t, "late reply settled", func() bool {
		instance.aiTraffic.mu.Lock()
		defer instance.aiTraffic.mu.Unlock()
		return instance.aiTraffic.pending == 5
	})
	if current := manager.List()[0]; current.State != StateRunning || current.Generation != status.Generation {
		t.Fatalf("queue time misclassified as provider fault: %+v", current)
	}
	if _, err := manager.Invoke(context.Background(), status.Manifest.ID, "ordinary", nil); err != nil {
		t.Fatal(err)
	}
}

func TestAIConcurrentProvidersShareResponseBudget(t *testing.T) {
	manager, status := runningAIProvider(t, "large")
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	var group sync.WaitGroup
	results := make(chan error, 32) // Two calls from each of 16 concurrent completions.
	for i := 0; i < 16; i++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			id := "first"
			if index%2 != 0 {
				id = "second"
			}
			for call := 0; call < 2; call++ {
				_, err := manager.InvokeAIProviderGeneration(ctx, status.Manifest.ID, status.Generation, id, status.Digest, aiArguments("pull", id))
				results <- err
			}
		}(i)
	}
	group.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	if manager.List()[0].State != StateRunning {
		t.Fatal("legal shared output tripped global protocol rate")
	}
}

func TestAILateOversizedReplyRetainsCreditThenFaults(t *testing.T) {
	manager, status := runningAIProvider(t, "late-oversize")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	manager.mu.Lock()
	instance := manager.instances[status.Manifest.ID]
	manager.mu.Unlock()
	go func() {
		_, err := manager.InvokeAIProviderGeneration(ctx, status.Manifest.ID, status.Generation, "first", status.Digest, aiArguments("pull", "first"))
		done <- err
	}()
	waitFor(t, "AI pull dispatched", func() bool {
		instance.process.mu.Lock()
		defer instance.process.mu.Unlock()
		return len(instance.process.pending) > 0
	})
	cancel()
	if !errors.Is(<-done, context.Canceled) {
		t.Fatal("caller cancellation changed")
	}
	instance.aiTraffic.mu.Lock()
	pending := instance.aiTraffic.pending
	instance.aiTraffic.mu.Unlock()
	if pending != 1 {
		t.Fatal("cancellation released AI credit")
	}
	// A cancel ACK is independent; the deliberately late oversized pull must still be checked.
	manager.InvokeAIProviderGeneration(context.Background(), status.Manifest.ID, status.Generation, "first", status.Digest, aiArguments("cancel", "first"))
	waitState(t, manager, status.Manifest.ID, StateFaulted)
	waitFor(t, "terminal transport released all credits", func() bool {
		instance.aiTraffic.mu.Lock()
		defer instance.aiTraffic.mu.Unlock()
		return instance.aiTraffic.pending == 0
	})
}
