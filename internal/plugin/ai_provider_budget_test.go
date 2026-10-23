package plugin

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestAISharedBudgetReservesCancelAndWaitsWithoutManagerLock(t *testing.T) {
	var budget aiProviderBudget
	credits := make([]*aiReplyCredit, 0, 6)
	for i := 0; i < 6; i++ {
		credit, err := budget.acquire(context.Background(), aiPullReplyBytes, false)
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
	blocked, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		credit, err := budget.acquire(blocked, aiPullReplyBytes, false)
		if credit != nil {
			credit.release()
		}
		result <- err
	}()
	waitFor(t, "normal budget waiter", func() bool { budget.mu.Lock(); defer budget.mu.Unlock(); return budget.waiters > 0 })
	cleanup, stop := context.WithTimeout(context.Background(), aiCancelTimeout)
	defer stop()
	control, err := budget.acquire(cleanup, aiControlReplyBytes, true)
	if err != nil {
		t.Fatalf("cancel starved by full normal credits: %v", err)
	}
	control.release()
	cancel()
	if !errors.Is(<-result, context.Canceled) {
		t.Fatal("blocked admission ignored cancellation")
	}
	budget.mu.Lock()
	pending, bytes := budget.pending, budget.reserved
	budget.mu.Unlock()
	if pending != 6 || bytes != 6*aiPullReplyBytes {
		t.Fatalf("unsettled count changed: %d %d", pending, bytes)
	}
}

func TestAIResponseBudgetSettlementIsExactlyOnce(t *testing.T) {
	var budget aiProviderBudget
	credit, err := budget.acquire(context.Background(), aiControlReplyBytes, true)
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for i := 0; i < 16; i++ {
		group.Add(1)
		go func() { defer group.Done(); credit.release() }()
	}
	group.Wait()
	budget.mu.Lock()
	defer budget.mu.Unlock()
	if budget.pending != 0 || budget.controls != 0 || budget.reserved != 0 {
		t.Fatal("duplicate settlement corrupted credits")
	}
}

func TestAIAdmissionTokenRefillAndBurstBounds(t *testing.T) {
	var budget aiProviderBudget
	base := time.Now()
	budget.initializeLocked(base)
	budget.frames = 0
	budget.bytes = 0
	budget.refillLocked(base.Add(time.Millisecond))
	if budget.frames > 0.0720001 || budget.bytes > 2097.153 {
		t.Fatal("token refill exceeded configured rates")
	}
	budget.refillLocked(base.Add(time.Hour))
	if budget.frames != aiFrameBurst || budget.bytes != aiByteBurst {
		t.Fatal("idle budget accumulated beyond burst")
	}
	if aiFrameBurst+aiFramesPerSecond+aiReplySlots != 96 || aiByteBurst+aiBytesPerSecond+aiReplyBytes != 4<<20 {
		t.Fatal("carry+admission response-window proof changed")
	}
}
