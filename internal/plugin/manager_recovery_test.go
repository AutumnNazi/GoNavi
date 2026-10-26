package plugin

import (
	"context"
	"encoding/json"
	"testing"
)

func TestPluginRecoversAfterReplacingFaultedPackage(t *testing.T) {
	manager := testManager(t)
	ctx := context.Background()
	broken := installFixture(t, manager, "test.recover", "crash")
	enableFixture(t, manager, broken.Manifest.ID)
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	waitState(t, manager, broken.Manifest.ID, StateFaulted)
	if _, err := manager.SetEnabled(ctx, broken.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	waitState(t, manager, broken.Manifest.ID, StateDisabled)
	fixed := installFixture(t, manager, "test.recover", "echo")
	if fixed.Digest == broken.Digest {
		t.Fatal("replacement reused the faulted digest")
	}
	enableFixture(t, manager, fixed.Manifest.ID)
	running := waitState(t, manager, fixed.Manifest.ID, StateRunning)
	if running.Generation == broken.Generation {
		t.Fatalf("generation was reused after replacement: %d", running.Generation)
	}
	result, err := manager.Invoke(ctx, fixed.Manifest.ID, "echo", json.RawMessage(`{"value":42}`))
	if err != nil {
		t.Fatal(err)
	}
	if string(result) != `{"value":42}` {
		t.Fatalf("invoke after recovery: %s", result)
	}
	if _, err = manager.SetEnabled(ctx, fixed.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	waitState(t, manager, fixed.Manifest.ID, StateDisabled)
}
