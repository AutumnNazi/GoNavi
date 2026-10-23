package plugin

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestAIProviderBackpressureCancelWakesEmitter(t *testing.T) {
	first, second, exited := make(chan struct{}), make(chan struct{}), make(chan struct{})
	d := aiTestDispatcher(t, AIProviderLimits{QueueEvents: 2}, func(_ context.Context, _ AIProviderStart, emit AIProviderEmit) (AIProviderCompletion, error) {
		defer close(exited)
		if err := emit(AIProviderDelta{Content: "one"}); err != nil {
			return AIProviderCompletion{}, err
		}
		close(first)
		err := emit(AIProviderDelta{Content: "two"})
		close(second)
		return AIProviderCompletion{FinishReason: "stop"}, err
	})
	if _, err := d.Handle(context.Background(), aiTestStart("one", "full")); err != nil {
		t.Fatal(err)
	}
	<-first
	select {
	case <-second:
		t.Fatal("producer did not backpressure")
	default:
	}
	if _, err := d.Handle(context.Background(), aiTestControl("cancel", "one", "full")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-exited:
	case <-time.After(time.Second):
		t.Fatal("cancel did not wake emitter")
	}
}

func TestAIProviderCanceledUncooperativeWorkersKeepSlots(t *testing.T) {
	// Sixteen entries are bounded by the worker cap and must not block producer setup.
	entered := make(chan struct{}, 16)
	release := make(chan struct{})
	d := aiTestDispatcher(t, AIProviderLimits{CloseWait: 20 * time.Millisecond}, func(context.Context, AIProviderStart, AIProviderEmit) (AIProviderCompletion, error) {
		entered <- struct{}{}
		<-release
		return AIProviderCompletion{FinishReason: "stop"}, nil
	})
	defer close(release)
	for index := 0; index < 16; index++ {
		id := fmt.Sprint("worker-", index)
		if _, err := d.Handle(context.Background(), aiTestStart("one", id)); err != nil {
			t.Fatal(err)
		}
		<-entered
		if _, err := d.Handle(context.Background(), aiTestControl("cancel", "one", id)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := d.Handle(context.Background(), aiTestStart("one", "overflow")); err == nil {
		t.Fatal("cancel released live worker slots")
	}
	for index := 0; index < 4100; index++ {
		if _, err := d.Handle(context.Background(), aiTestControl("cancel", "one", fmt.Sprint("unknown-", index))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := d.Handle(context.Background(), aiTestStart("one", "worker-0")); err == nil {
		t.Fatal("live canceled ID replayed after tombstone eviction")
	}
	if err := d.Close(context.Background()); err == nil {
		t.Fatal("uncooperative workers reported joined")
	}
}

func TestAIProviderCompletedQueuesRemainBounded(t *testing.T) {
	d := aiTestDispatcher(t, AIProviderLimits{MaxSessions: 2}, func(context.Context, AIProviderStart, AIProviderEmit) (AIProviderCompletion, error) {
		return AIProviderCompletion{FinishReason: "stop"}, nil
	})
	for _, id := range []string{"a", "b"} {
		if _, err := d.Handle(context.Background(), aiTestStart("one", id)); err != nil {
			t.Fatal(err)
		}
	}
	aiTestWait(t, func() bool { d.mu.Lock(); defer d.mu.Unlock(); return d.workers == 0 })
	if _, err := d.Handle(context.Background(), aiTestStart("one", "c")); err == nil {
		t.Fatal("completed queues grew without bound")
	}
	aiTestPull(t, d, "one", "a")
	if _, err := d.Handle(context.Background(), aiTestStart("one", "c")); err != nil {
		t.Fatal(err)
	}
}

func TestAIProviderIdleLeaseCancelsWithoutFurtherRequests(t *testing.T) {
	canceled := make(chan struct{})
	d := aiTestDispatcher(t, AIProviderLimits{IdleLease: 80 * time.Millisecond}, func(ctx context.Context, _ AIProviderStart, _ AIProviderEmit) (AIProviderCompletion, error) {
		<-ctx.Done()
		close(canceled)
		return AIProviderCompletion{}, ctx.Err()
	})
	if _, err := d.Handle(context.Background(), aiTestStart("one", "abandoned")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("idle lease required another request to cancel")
	}
	if _, err := d.Handle(context.Background(), aiTestControl("pull", "one", "abandoned")); err == nil {
		t.Fatal("expired request returned pending success")
	}
}

func TestAIProviderPendingPullRenewsLeaseAndCanBeCanceled(t *testing.T) {
	d := aiTestDispatcher(t, AIProviderLimits{PullWait: 10 * time.Millisecond}, func(ctx context.Context, _ AIProviderStart, _ AIProviderEmit) (AIProviderCompletion, error) {
		<-ctx.Done()
		return AIProviderCompletion{}, ctx.Err()
	})
	if _, err := d.Handle(context.Background(), aiTestStart("one", "pending")); err != nil {
		t.Fatal(err)
	}
	key := "one\x00pending"
	d.mu.Lock()
	session := d.sessions[key]
	session.lastPull = time.Now().Add(-time.Minute)
	d.mu.Unlock()
	if events := aiTestPull(t, d, "one", "pending"); len(events) != 0 {
		t.Fatal("pending pull invented a terminal")
	}
	d.expire(session, true)
	d.mu.Lock()
	closed := session.closed
	d.mu.Unlock()
	if closed {
		t.Fatal("valid pending pull failed to renew lease")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := d.Handle(ctx, aiTestControl("pull", "one", "pending")); err == nil {
		t.Fatal("canceled pull succeeded")
	}
	d.Abort()
	if _, err := d.Handle(context.Background(), aiTestControl("pull", "one", "pending")); err == nil {
		t.Fatal("Abort retained output")
	}
}
