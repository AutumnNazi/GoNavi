package plugin

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestAIAdmissionDoesNotBargePastOlderNormalWaiter(t *testing.T) {
	var budget aiProviderBudget
	// Simulate an older caller descheduled immediately after registering its FIFO ticket.
	older, err := budget.beginWait(false)
	if err != nil {
		t.Fatal(err)
	}
	defer budget.endWait(older)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	credit, err := budget.acquire(ctx, aiPullReplyBytes, false)
	if credit != nil {
		credit.release()
		t.Fatal("new normal caller bypassed an older registered waiter")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("queued caller: %v", err)
	}
}

func TestAIControlPriorityDoesNotLoseNormalFIFO(t *testing.T) {
	var budget aiProviderBudget
	older, err := budget.beginWait(false)
	if err != nil {
		t.Fatal(err)
	}
	newer, err := budget.beginWait(false)
	if err != nil {
		t.Fatal(err)
	}
	control, err := budget.acquire(context.Background(), aiControlReplyBytes, true)
	if err != nil {
		t.Fatal(err)
	}
	control.release()
	budget.endWait(older)
	budget.mu.Lock()
	head := budget.normalQueue[0]
	budget.mu.Unlock()
	if head != newer {
		t.Fatal("control cleanup reordered normal tickets")
	}
	budget.endWait(newer)
	if credit, err := budget.acquire(context.Background(), aiPullReplyBytes, false); err != nil {
		t.Fatal(err)
	} else {
		credit.release()
	}
}
