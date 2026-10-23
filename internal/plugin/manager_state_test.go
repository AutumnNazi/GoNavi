package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestDependencyTransitionsAndCycles(t *testing.T) {
	m := testManager(t)
	ctx := context.Background()
	a := basicManifest("test.parent")
	a.Requires = []Dependency{{ID: "test.dependency", MinVersion: "1.0.0"}}
	installSource(t, m, writePackage(t, a))
	enableFixture(t, m, a.ID)
	if err := m.Start(ctx); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, a.ID, StateBlocked)
	dep := installFixture(t, m, "test.dependency", "")
	enableFixture(t, m, dep.Manifest.ID)
	first := waitState(t, m, a.ID, StateRunning)
	if _, err := m.SetEnabled(ctx, dep.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	blocked := waitState(t, m, a.ID, StateBlocked)
	if blocked.Generation <= first.Generation {
		t.Fatal("dependency loss did not fence parent")
	}
	enableFixture(t, m, dep.Manifest.ID)
	next := waitState(t, m, a.ID, StateRunning)
	if next.Generation <= first.Generation {
		t.Fatal("parent generation reused")
	}
	b := basicManifest("test.cycle-one")
	c := basicManifest("test.cycle-two")
	b.Requires = []Dependency{{ID: c.ID}}
	c.Requires = []Dependency{{ID: b.ID}}
	installSource(t, m, writePackage(t, b))
	installSource(t, m, writePackage(t, c))
	enableFixture(t, m, b.ID)
	enableFixture(t, m, c.ID)
	waitState(t, m, b.ID, StateBlocked)
	waitState(t, m, c.ID, StateBlocked)
	optional := basicManifest("test.optional")
	optional.Requires = []Dependency{{ID: "missing.optional", Optional: true}}
	installSource(t, m, writePackage(t, optional))
	enableFixture(t, m, optional.ID)
	waitState(t, m, optional.ID, StateRunning)
}
func TestSafeModeAndUnstartedControllerNeverExecute(t *testing.T) {
	m := testManager(t)
	status := installFixture(t, m, "test.safe", "crash")
	enableFixture(t, m, status.Manifest.ID)
	m.mu.Lock()
	count := len(m.instances)
	m.mu.Unlock()
	if count != 0 {
		t.Fatal("control-only manager executed code")
	}
	safe, err := NewManager(Options{Root: m.root, Disabled: true})
	if err != nil {
		t.Fatal(err)
	}
	defer safe.Close(context.Background())
	if err = safe.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err = safe.SetEnabled(context.Background(), status.Manifest.ID, true); !errors.Is(err, ErrDisabled) {
		t.Fatalf("safe mode enabled plugin: %v", err)
	}
	if _, err = safe.Invoke(context.Background(), status.Manifest.ID, "echo", nil); !errors.Is(err, ErrDisabled) {
		t.Fatalf("safe mode invoked plugin: %v", err)
	}
	if _, err = safe.SetEnabled(context.Background(), status.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	safe.mu.Lock()
	count = len(safe.instances)
	safe.mu.Unlock()
	if count != 0 {
		t.Fatal("safe mode launched subprocess")
	}
}
func TestConcurrentControllersMergeDurableState(t *testing.T) {
	m := testManager(t)
	a := installFixture(t, m, "test.first", "")
	b := installFixture(t, m, "test.second", "")
	other := managerAt(t, m.root)
	var group sync.WaitGroup
	failures := make(chan error, 2)
	for index, controller := range []*Manager{m, other} {
		id := a.Manifest.ID
		if index == 1 {
			id = b.Manifest.ID
		}
		group.Add(1)
		go func() {
			defer group.Done()
			for i := 0; i < 12; i++ {
				if _, err := controller.SetEnabled(context.Background(), id, i%2 == 1); err != nil {
					failures <- err
					return
				}
			}
		}()
	}
	group.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	statuses := m.List()
	if len(statuses) != 2 || !statuses[0].DesiredEnabled || !statuses[1].DesiredEnabled {
		t.Fatalf("lost concurrent update: %#v", statuses)
	}
}
func TestPermissionChangesRequireDisabledRetrust(t *testing.T) {
	m := testManager(t)
	ctx := context.Background()
	manifest := basicManifest("test.permissions")
	source := writePackage(t, manifest)
	old := installSource(t, m, source)
	enableFixture(t, m, manifest.ID)
	manifest.Version = "2.0.0"
	manifest.Permissions = []string{"db.write"}
	updated := writePackage(t, manifest)
	inspection, err := m.Inspect(ctx, updated)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.Install(ctx, InstallRequest{Path: updated, Digest: inspection.Digest, Trusted: true}); err == nil {
		t.Fatal("live permission upgrade accepted")
	}
	if _, err = m.SetEnabled(ctx, manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err = m.Install(ctx, InstallRequest{Path: updated, Digest: inspection.Digest}); err == nil {
		t.Fatal("permission increase without trust accepted")
	}
	if current := m.List()[0]; current.Digest != old.Digest || current.Manifest.Version != "1.0.0" {
		t.Fatal("failed update changed installed package")
	}
	next, err := m.Install(ctx, InstallRequest{Path: updated, Digest: inspection.Digest, Trusted: true})
	if err != nil {
		t.Fatal(err)
	}
	if next.DesiredEnabled || next.Manifest.Version != "2.0.0" {
		t.Fatal("update inherited enabled state")
	}
}
func TestGenerationNeverReusedAfterRemove(t *testing.T) {
	m := testManager(t)
	ctx := context.Background()
	old := installFixture(t, m, "test.reinstall", "echo")
	enableFixture(t, m, old.Manifest.ID)
	if err := m.Start(ctx); err != nil {
		t.Fatal(err)
	}
	running := waitState(t, m, old.Manifest.ID, StateRunning)
	if _, err := m.SetEnabled(ctx, old.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, old.Manifest.ID, StateDisabled)
	if err := m.Remove(ctx, old.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	next := installFixture(t, m, old.Manifest.ID, "echo")
	if next.Generation <= running.Generation {
		t.Fatal("reinstall reused generation")
	}
	enableFixture(t, m, next.Manifest.ID)
	waitState(t, m, next.Manifest.ID, StateRunning)
	if _, err := m.InvokeGeneration(ctx, next.Manifest.ID, running.Generation, "echo", nil); !errors.Is(err, ErrDisabled) {
		t.Fatalf("old UI admitted after reinstall: %v", err)
	}
}
func TestInvocationTimeoutQuarantinesAndCloseIsBounded(t *testing.T) {
	m := testManager(t)
	status := installFixture(t, m, "test.timeout", "ignore-cancel")
	enableFixture(t, m, status.Manifest.ID)
	if err := m.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, status.Manifest.ID, StateRunning)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := m.Invoke(ctx, status.Manifest.ID, "echo", nil); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("invocation deadline: %v", err)
	}
	waitState(t, m, status.Manifest.ID, StateFaulted)
	closing, stop := context.WithTimeout(context.Background(), time.Millisecond)
	defer stop()
	err := m.Close(closing)
	if err != nil && !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	waitFor(t, "owner closed", func() bool {
		select {
		case <-m.done:
			return true
		default:
			return false
		}
	})
	next := managerAt(t, m.root)
	if err = next.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
}
func TestPersistentStateCorruptionFailsClosed(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "state.json"), []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewManager(Options{Root: root}); err == nil {
		t.Fatal("corrupt state accepted")
	}
}
func TestSnapshotOwnership(t *testing.T) {
	m := testManager(t)
	manifest := basicManifest("test.snapshot")
	manifest.Permissions = []string{"db.read"}
	installSource(t, m, writePackage(t, manifest))
	snapshot := m.List()
	snapshot[0].Manifest.Permissions[0] = "db.write"
	if m.List()[0].Manifest.Permissions[0] != "db.read" {
		t.Fatal("caller mutated persisted permission snapshot")
	}
	raw, err := json.Marshal(m.List())
	if err != nil || len(raw) == 0 {
		t.Fatal("snapshot not serializable")
	}
}
