package plugin

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestAIWatchdogSurvivesCallerDeadlineAndHealthyPong(t *testing.T) {
	manager, status := runningAIProvider(t, "hold")
	manager.opts.InvocationTimeout = 60 * time.Millisecond
	manager.mu.Lock()
	instance := manager.instances[status.Manifest.ID]
	manager.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := manager.InvokeAIProviderGeneration(ctx, status.Manifest.ID, status.Generation, "first", status.Digest, aiArguments("pull", "first")); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("caller deadline: %v", err)
	}
	if manager.List()[0].State != StateRunning {
		t.Fatal("caller timeout quarantined before own pending watchdog")
	}
	pong, pongCancel := context.WithTimeout(context.Background(), time.Second)
	defer pongCancel()
	if _, err := instance.process.call(pong, "plugin.ping", struct{}{}); err != nil {
		t.Fatalf("fixture was not responsive to heartbeat: %v", err)
	}
	waitState(t, manager, status.Manifest.ID, StateFaulted)
	waitFor(t, "watchdog settled canceled reply credit", func() bool {
		instance.aiTraffic.mu.Lock()
		defer instance.aiTraffic.mu.Unlock()
		return instance.aiTraffic.pending == 0
	})
}

func TestAILateReplyStopsPendingWatchdogWithoutFault(t *testing.T) {
	manager, status := runningAIProvider(t, "delay")
	manager.opts.InvocationTimeout = 200 * time.Millisecond
	manager.mu.Lock()
	instance := manager.instances[status.Manifest.ID]
	manager.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := manager.InvokeAIProviderGeneration(ctx, status.Manifest.ID, status.Generation, "first", status.Digest, aiArguments("pull", "first")); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("caller deadline: %v", err)
	}
	waitFor(t, "late75ms reply settled", func() bool {
		instance.aiTraffic.mu.Lock()
		defer instance.aiTraffic.mu.Unlock()
		return instance.aiTraffic.pending == 0
	})
	timer := time.NewTimer(210 * time.Millisecond)
	<-timer.C
	timer.Stop()
	if manager.List()[0].State != StateRunning {
		t.Fatal("settled late reply retained a live watchdog")
	}
}
