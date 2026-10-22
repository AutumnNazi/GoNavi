package plugin

import (
	"context"
	"errors"
	"testing"
)

func TestAIGenerationCheckRejectsExternallyRevokedDependencyWithoutAdmission(t *testing.T) {
	manager := managerAt(t, t.TempDir())
	ctx := context.Background()
	dependency := installSource(t, manager, writePackage(t, basicManifest("example.dependency")))
	target := installAIProviderFixture(t, manager, "normal", Dependency{ID: dependency.Manifest.ID, MinVersion: "1.0.0"})
	enableFixture(t, manager, dependency.Manifest.ID)
	enableFixture(t, manager, target.Manifest.ID)
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	waitState(t, manager, dependency.Manifest.ID, StateRunning)
	target = waitState(t, manager, target.Manifest.ID, StateRunning)
	if err := manager.CheckAIProviderGeneration(ctx, target.Manifest.ID, target.Generation, "first", target.Digest); err != nil {
		t.Fatal(err)
	}
	manager.mu.Lock()
	instance := manager.instances[target.Manifest.ID]
	manager.mu.Unlock()
	if instance == nil {
		t.Fatal("fixture has no live target instance")
	}
	observer := managerAt(t, manager.root)
	// External durable revocation must be rejected without consuming an invocation lease.
	if _, err := observer.SetEnabled(ctx, dependency.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}

	if err := manager.CheckAIProviderGeneration(ctx, target.Manifest.ID, target.Generation, "first", target.Digest); !errors.Is(err, ErrDisabled) {
		t.Fatalf("revoked dependency admitted: %v", err)
	}
	manager.mu.Lock()
	inflight := instance.inflight
	manager.mu.Unlock()
	instance.aiTraffic.mu.Lock()
	pending, waiters := instance.aiTraffic.pending, instance.aiTraffic.waiters
	instance.aiTraffic.mu.Unlock()
	if inflight != 0 || pending != 0 || waiters != 0 {
		t.Fatal("readonly generation check consumed invocation capacity")
	}
}
