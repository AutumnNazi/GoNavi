package plugin

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestAIControlWaitersCannotBeStarvedByFullNormalQueue(t *testing.T) {
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
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	results := make(chan error, aiMaxWaiters) // Collect every bounded waiter, including cancellation failures.
	var group sync.WaitGroup
	for i := 0; i < aiMaxWaiters; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			credit, err := budget.acquire(ctx, aiPullReplyBytes, false)
			if credit != nil {
				credit.release()
			}
			results <- err
		}()
	}
	waitFor(t, "normal wait queue saturated", func() bool {
		budget.mu.Lock()
		defer budget.mu.Unlock()
		return budget.waiters-budget.cancelWaiters == aiMaxWaiters
	})
	cleanup, stop := context.WithTimeout(context.Background(), aiCancelTimeout)
	defer stop()
	credit, err := budget.acquire(cleanup, aiControlReplyBytes, true)
	if err != nil {
		t.Fatalf("normal waiters blocked reserved cancel admission: %v", err)
	}
	credit.release()
	cancel()
	group.Wait()
	close(results)
	for err := range results {
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("unexpected queued result: %v", err)
		}
	}
	budget.mu.Lock()
	defer budget.mu.Unlock()
	if budget.waiters != 0 || budget.cancelWaiters != 0 || budget.pending != 6 {
		t.Fatalf("waiters/credits leaked: %d %d %d", budget.waiters, budget.cancelWaiters, budget.pending)
	}
}

func TestAIControlWaitQueueAndDeadlineAreBounded(t *testing.T) {
	var budget aiProviderBudget
	var waiters []*aiBudgetWaiter
	for i := 0; i < aiMaxControlWaiters; i++ {
		waiter, err := budget.beginWait(true)
		if err != nil {
			t.Fatal(err)
		}
		waiters = append(waiters, waiter)
	}
	if _, err := budget.beginWait(true); !errors.Is(err, ErrBusy) {
		t.Fatal("unbounded control wait queue")
	}
	for _, waiter := range waiters {
		budget.endWait(waiter)
	}
	var credits []*aiReplyCredit
	for i := 0; i < aiControlSlots; i++ {
		credit, err := budget.acquire(context.Background(), aiControlReplyBytes, true)
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
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if _, err := budget.acquire(ctx, aiControlReplyBytes, true); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("control deadline: %v", err)
	}
	budget.mu.Lock()
	defer budget.mu.Unlock()
	if budget.waiters != 0 || budget.cancelWaiters != 0 || budget.controls != aiControlSlots {
		t.Fatal("deadline leaked waiters or released unsettled controls")
	}
}
