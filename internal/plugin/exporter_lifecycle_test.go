package plugin

import (
	"context"
	"errors"
	"testing"
)

func TestExporterDisableRejectsInFlightCompletion(t *testing.T) {
	manager, status := runningExporter(t, "hold")
	manager.mu.Lock()
	instance := manager.instances[status.Manifest.ID]
	manager.mu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1) // Collect the only render result after lifecycle cancellation.
	go func() {
		_, err := manager.InvokeExporterGeneration(ctx, status.Manifest.ID, status.Generation, "ndjson", status.Digest, exporterArguments("ndjson"))
		result <- err
	}()
	waitFor(t, "exporter request dispatched", func() bool {
		instance.process.mu.Lock()
		defer instance.process.mu.Unlock()
		for _, call := range instance.process.pending {
			if call.policy.maxResponseBytes == maxExporterJSONBytes+1024 {
				return true
			}
		}
		return false
	})
	if _, err := manager.SetEnabled(context.Background(), status.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err == nil {
		t.Fatal("disabled in-flight render succeeded")
	}
	if err := manager.CheckExporterGeneration(context.Background(), status.Manifest.ID, status.Generation, "ndjson", status.Digest); !errors.Is(err, ErrDisabled) {
		t.Fatalf("disabled completion authority survived: %v", err)
	}
	waitFor(t, "exporter inflight released", func() bool { manager.mu.Lock(); defer manager.mu.Unlock(); return instance.inflight == 0 })
}
