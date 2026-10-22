package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func exporterArguments(id string) json.RawMessage {
	return json.RawMessage(`{"protocolVersion":1,"exporterId":"` + id + `","columns":["value"],"rows":[[{"kind":"string","value":"safe"}]]}`)
}

func runningExporter(t *testing.T, mode string) (*Manager, Status) {
	t.Helper()
	manager := managerAt(t, t.TempDir())
	status := installExporterFixture(t, manager, mode)
	enableFixture(t, manager, status.Manifest.ID)
	if err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	status = waitState(t, manager, status.Manifest.ID, StateRunning)
	waitFor(t, "exporter ready", func() bool {
		manager.mu.Lock()
		defer manager.mu.Unlock()
		instance := manager.instances[status.Manifest.ID]
		return instance != nil && instance.ready
	})
	return manager, status
}

func TestExporterPrivateInvocationAndGenerationFences(t *testing.T) {
	manager, status := runningExporter(t, "normal")
	ctx := context.Background()
	args := exporterArguments("ndjson")
	for _, invoke := range []func() (json.RawMessage, error){func() (json.RawMessage, error) { return manager.Invoke(ctx, status.Manifest.ID, "render", args) }, func() (json.RawMessage, error) {
		return manager.InvokeGeneration(ctx, status.Manifest.ID, status.Generation, "render", args)
	}} {
		if _, err := invoke(); !errors.Is(err, ErrExporterCommandReserved) {
			t.Fatalf("generic bypass %v", err)
		}
	}
	if _, err := manager.Invoke(ctx, status.Manifest.ID, "ordinary", nil); err != nil {
		t.Fatal("ordinary invocation changed", err)
	}
	result, err := manager.InvokeExporterGeneration(ctx, status.Manifest.ID, status.Generation, "ndjson", status.Digest, args)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(result), `"rowCount":1`) {
		t.Fatal("real subprocess did not render")
	}
	if _, err = manager.InvokeExporterGeneration(ctx, status.Manifest.ID, status.Generation, "second", status.Digest, args); err == nil {
		t.Fatal("cross-exporter request accepted")
	}
	if err = manager.CheckExporterGeneration(ctx, status.Manifest.ID, status.Generation, "ndjson", strings.Repeat("f", 64)); !errors.Is(err, ErrDigestMismatch) {
		t.Fatal("digest fence", err)
	}
	observer := managerAt(t, manager.root)
	if err = observer.CheckExporterGeneration(ctx, status.Manifest.ID, status.Generation, "ndjson", status.Digest); !errors.Is(err, ErrDisabled) {
		t.Fatal("foreign owner checked successfully", err)
	}
	if _, err = manager.SetEnabled(ctx, status.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	if err = manager.CheckExporterGeneration(ctx, status.Manifest.ID, status.Generation, "ndjson", status.Digest); !errors.Is(err, ErrDisabled) {
		t.Fatal("disabled generation accepted", err)
	}
	enableFixture(t, manager, status.Manifest.ID)
	fresh := waitState(t, manager, status.Manifest.ID, StateRunning)
	if _, err = manager.InvokeExporterGeneration(ctx, status.Manifest.ID, status.Generation, "ndjson", status.Digest, args); !errors.Is(err, ErrDisabled) {
		t.Fatal("old generation rebound", err)
	}
	if _, err = manager.InvokeExporterGeneration(ctx, status.Manifest.ID, fresh.Generation, "ndjson", fresh.Digest, args); err != nil {
		t.Fatal(err)
	}
}

func TestExporterCallerCancelAndPendingWatchdog(t *testing.T) {
	t.Run("healthy late response", func(t *testing.T) {
		manager, status := runningExporter(t, "delay")
		manager.opts.InvocationTimeout = 200 * time.Millisecond
		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()
		if _, err := manager.InvokeExporterGeneration(ctx, status.Manifest.ID, status.Generation, "ndjson", status.Digest, exporterArguments("ndjson")); !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("caller timeout %v", err)
		}
		timer := time.NewTimer(220 * time.Millisecond)
		<-timer.C
		timer.Stop()
		if manager.List()[0].State != StateRunning {
			t.Fatal("caller cancellation faulted healthy exporter")
		}
	})
	t.Run("unresponsive export", func(t *testing.T) {
		manager, status := runningExporter(t, "hold")
		manager.opts.InvocationTimeout = 80 * time.Millisecond
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
		defer cancel()
		if _, err := manager.InvokeExporterGeneration(ctx, status.Manifest.ID, status.Generation, "ndjson", status.Digest, exporterArguments("ndjson")); !errors.Is(err, context.DeadlineExceeded) {
			t.Fatal(err)
		}
		waitState(t, manager, status.Manifest.ID, StateFaulted)
	})
}

func TestExporterOversizedReplyFailsClosed(t *testing.T) {
	manager, status := runningExporter(t, "oversize")
	if _, err := manager.InvokeExporterGeneration(context.Background(), status.Manifest.ID, status.Generation, "ndjson", status.Digest, exporterArguments("ndjson")); err == nil {
		t.Fatal("oversized reply accepted")
	}
	waitState(t, manager, status.Manifest.ID, StateFaulted)
}

func TestExporterCheckRejectsDependencyRevocationWithoutAdmission(t *testing.T) {
	manager := managerAt(t, t.TempDir())
	ctx := context.Background()
	dependency := installSource(t, manager, writePackage(t, basicManifest("example.export-base")))
	target := installExporterFixture(t, manager, "normal", Dependency{ID: dependency.Manifest.ID, MinVersion: "1.0.0"})
	enableFixture(t, manager, dependency.Manifest.ID)
	enableFixture(t, manager, target.Manifest.ID)
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	waitState(t, manager, dependency.Manifest.ID, StateRunning)
	target = waitState(t, manager, target.Manifest.ID, StateRunning)
	if err := manager.CheckExporterGeneration(ctx, target.Manifest.ID, target.Generation, "ndjson", target.Digest); err != nil {
		t.Fatal(err)
	}
	manager.mu.Lock()
	instance := manager.instances[target.Manifest.ID]
	manager.mu.Unlock()
	if instance == nil {
		t.Fatal("missing instance")
	}
	observer := managerAt(t, manager.root)
	if _, err := observer.SetEnabled(ctx, dependency.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := manager.CheckExporterGeneration(ctx, target.Manifest.ID, target.Generation, "ndjson", target.Digest); !errors.Is(err, ErrDisabled) {
		t.Fatalf("dependency revocation accepted %v", err)
	}
	manager.mu.Lock()
	inflight := instance.inflight
	manager.mu.Unlock()
	if inflight != 0 {
		t.Fatal("readonly check consumed admission")
	}
}
