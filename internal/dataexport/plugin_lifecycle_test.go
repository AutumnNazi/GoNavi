package dataexport

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginExporterRejectsLateCanceledAndRevokedReply(t *testing.T) {
	manager, exporter, _ := pluginExporterFixture(t, false)
	snapshot, err := PreparePluginExportSnapshot(context.Background(), []map[string]any{{"x": "value"}}, []string{"x"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Run("caller cancellation wins late success", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		entered := make(chan struct{})
		calls := 0
		exporter.invoke = func(call context.Context, _ json.RawMessage) (json.RawMessage, error) {
			calls++
			close(entered)
			<-call.Done()
			return []byte(`{"protocolVersion":1,"rowCount":1,"text":"late"}`), nil
		}
		done := make(chan error, 1)
		go func() {
			out, err := exporter.Render(ctx, snapshot)
			if out != nil {
				t.Error("late canceled bytes returned")
			}
			done <- err
		}()
		select {
		case <-entered:
		case <-time.After(3 * time.Second):
			t.Fatal("render did not dispatch")
		}
		cancel()
		select {
		case err := <-done:
			if !errors.Is(err, context.Canceled) || calls != 1 {
				t.Fatalf("cancel/replay mismatch: %v calls=%d", err, calls)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("canceled render did not return")
		}
	})
	t.Run("generation revoked before return", func(t *testing.T) {
		exporter.invoke = func(ctx context.Context, _ json.RawMessage) (json.RawMessage, error) {
			if _, err := manager.SetEnabled(ctx, exporter.pluginID, false); err != nil {
				t.Error(err)
			}
			return []byte(`{"protocolVersion":1,"rowCount":1,"text":"revoked"}`), nil
		}
		out, err := exporter.Render(context.Background(), snapshot)
		if out != nil || err != ErrPluginExporterUnavailable {
			t.Fatalf("revoked output returned: %v", err)
		}
	})
}
func TestPluginExporterExternalDependencyRevocationBeforeReturn(t *testing.T) {
	manager, exporter, root := pluginExporterFixture(t, true)
	ctx := context.Background()
	timer := time.NewTimer(100 * time.Millisecond)
	defer timer.Stop()
	<-timer.C
	controller, err := plugin.NewManager(plugin.Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(ctx, time.Second)
		defer cancel()
		if err := controller.Close(cleanup); err != nil {
			t.Error(err)
		}
	})
	snapshot, err := PreparePluginExportSnapshot(ctx, []map[string]any{{"x": "value"}}, []string{"x"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	exporter.invoke = func(call context.Context, _ json.RawMessage) (json.RawMessage, error) {
		if _, err := controller.SetEnabled(call, "test.export-dependency", false); err != nil {
			t.Error(err)
		}
		for _, status := range manager.List() {
			if status.Manifest.ID == exporter.pluginID && status.State != plugin.StateRunning {
				t.Error("test missed pre-reconcile window")
			}
		}
		return []byte(`{"protocolVersion":1,"rowCount":1,"text":"stale"}`), nil
	}
	out, err := exporter.Render(ctx, snapshot)
	if out != nil || err != ErrPluginExporterUnavailable {
		t.Fatalf("dependency-revoked output returned: %v", err)
	}
}
func TestPluginExporterSelectionAndCanceledReplyValidation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewPluginExporter(ctx, nil, "bad", PluginExportSelection{}); err != context.Canceled {
		t.Fatal("constructor lost caller cancellation")
	}
	if _, err := pluginExportReply(ctx, []byte(`{"protocolVersion":1,"rowCount":0,"text":""}`), 0); err != context.Canceled {
		t.Fatal("reply validation hid caller cancellation")
	}
	for _, format := range []string{"csv", "plugin", " Plugin:x.y:z", "plugin:x.y:z "} {
		if _, err := NewPluginExporter(context.Background(), nil, format, PluginExportSelection{}); err != ErrPluginExportSelection {
			t.Fatal("invalid format/pin was normalized")
		}
	}
}
