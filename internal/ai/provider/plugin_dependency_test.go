package provider

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/plugin"
)

func pluginFixtureDependency(t *testing.T, m *plugin.Manager) {
	t.Helper()
	source := t.TempDir()
	manifest := plugin.Manifest{SchemaVersion: 1, APIVersion: 1, ID: "test.dependency", Name: "Static dependency", Version: "1.0.0"}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	inspection, err := m.Inspect(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.Install(ctx, plugin.InstallRequest{Path: source, Digest: inspection.Digest, Trusted: true}); err != nil {
		t.Fatal(err)
	}
	if _, err = m.SetEnabled(ctx, manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if err = m.Start(ctx); err != nil {
		t.Fatal(err)
	}
	deadline, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		for _, s := range m.List() {
			if s.Manifest.ID == manifest.ID && s.State == plugin.StateRunning {
				return
			}
		}
		select {
		case <-deadline.Done():
			t.Fatal("dependency not ready")
		case <-ticker.C:
		}
	}
}

func TestPluginCachedBatchRejectsExternallyRevokedDependency(t *testing.T) {
	manager, factory, _, root := pluginFixtureManagerOptions(t, true)
	ctx := context.Background()
	if _, err := manager.SetEnabled(ctx, "test.models", true); err != nil {
		t.Fatal(err)
	}
	config := pluginTestConfig()
	config.Headers = map[string]string{"X-Cached-Batch": "yes"}
	instance, err := factory.New(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	// Drain the startup notification before the external-controller-only state change.
	timer := time.NewTimer(100 * time.Millisecond)
	defer timer.Stop()
	<-timer.C
	external, err := plugin.NewManager(plugin.Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(ctx, time.Second)
		defer cancel()
		if err := external.Close(cleanup); err != nil {
			t.Error(err)
		}
	})
	entered, release := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	var calls atomic.Int32
	go func() {
		done <- instance.ChatStream(ctx, pluginStreamRequest(), func(ai.StreamChunk) {
			if calls.Add(1) == 1 {
				close(entered)
				<-release
			}
		})
	}()
	select {
	case <-entered:
	case err := <-done:
		t.Fatalf("no first callback: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("first callback stalled")
	}
	if _, err = external.SetEnabled(ctx, "test.dependency", false); err != nil {
		close(release)
		t.Fatal(err)
	}
	for _, s := range manager.List() {
		if s.Manifest.ID == "test.models" && s.State != plugin.StateRunning {
			close(release)
			t.Fatal("test missed pre-reconcile window")
		}
	}
	close(release)
	select {
	case err := <-done:
		if err == nil || calls.Load() != 1 {
			t.Fatalf("revoked dependency published cached output: err=%v callbacks=%d", err, calls.Load())
		}
	case <-time.After(3 * time.Second):
		t.Fatal("revoked stream did not stop")
	}
}
