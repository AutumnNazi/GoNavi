package plugin

import (
	"context"
	"testing"
)

func TestOwnsRuntimeFollowsOwnerLifecycle(t *testing.T) {
	m := testManager(t)
	if m.OwnsRuntime() {
		t.Fatal("controller-only manager claims runtime ownership")
	}
	ctx, cancel := context.WithCancel(context.Background())
	if err := m.Start(ctx); err != nil {
		t.Fatal(err)
	}
	if !m.OwnsRuntime() {
		t.Fatal("started owner has no runtime authority")
	}
	other := managerAt(t, m.root)
	if other.OwnsRuntime() {
		t.Fatal("second controller inherited runtime authority")
	}
	cancel()
	waitFor(t, "canceled owner releases authority", func() bool { return !m.OwnsRuntime() })
	if err := other.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !other.OwnsRuntime() {
		t.Fatal("new owner did not acquire authority")
	}
	if err := other.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if other.OwnsRuntime() {
		t.Fatal("closed manager retains runtime authority")
	}
}
