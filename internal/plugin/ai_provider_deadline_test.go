package plugin

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestAIOwnDispatchTimeoutStillQuarantines(t *testing.T) {
	manager, status := runningAIProvider(t, "hold")
	manager.opts.InvocationTimeout = 60 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := manager.InvokeAIProviderGeneration(ctx, status.Manifest.ID, status.Generation, "first", status.Digest, aiArguments("pull", "first")); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("runtime watchdog: %v", err)
	}
	if ctx.Err() != nil {
		t.Fatal("fixture exhausted caller instead of runtime budget")
	}
	waitState(t, manager, status.Manifest.ID, StateFaulted)
}

func TestAIAdmissionDeadlineDoesNotDispatchOrQuarantine(t *testing.T) {
	manager, status := runningAIProvider(t, "normal")
	caller, stopCaller := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer stopCaller()
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
	if _, err := manager.InvokeAIProviderGeneration(caller, status.Manifest.ID, status.Generation, "first", status.Digest, aiArguments("pull", "first")); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("admission deadline: %v", err)
	}
	if manager.List()[0].State != StateRunning {
		t.Fatal("admission wait faulted healthy process")
	}
	instance.aiTraffic.mu.Lock()
	defer instance.aiTraffic.mu.Unlock()
	if instance.aiTraffic.waiters != 0 || instance.aiTraffic.pending != 6 {
		t.Fatal("admission timeout leaked waiter or changed old credits")
	}
}

func TestAICanceledCallerWinsOverSaturatedWaitQueue(t *testing.T) {
	var budget aiProviderBudget
	var waiters []*aiBudgetWaiter
	for i := 0; i < aiMaxWaiters; i++ {
		waiter, err := budget.beginWait(false)
		if err != nil {
			t.Fatal(err)
		}
		waiters = append(waiters, waiter)
	}
	defer func() {
		for _, waiter := range waiters {
			budget.endWait(waiter)
		}
	}()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := budget.acquire(ctx, aiPullReplyBytes, false); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled caller misreported as capacity error: %v", err)
	}
}
