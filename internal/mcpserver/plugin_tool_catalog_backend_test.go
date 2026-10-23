package mcpserver

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

func TestPluginToolHeadlessLookupDoesNotActivateExecution(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	root := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	backend, err := NewAppBackendWithDataRoot(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := backend.Close(context.Background()); err != nil {
			t.Error(err)
		}
	})
	if tools, err := NewPluginToolCatalogForBackend(backend).List(ctx); err != nil || len(tools) != 0 {
		t.Fatalf("initial catalog: %v %v", tools, err)
	}
	probe, err := plugin.NewManager(plugin.Options{Root: filepath.Join(root, "plugins")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		if err := probe.Close(cleanup); err != nil {
			t.Error(err)
		}
	})
	if err := probe.Start(ctx); err != nil {
		t.Fatalf("plain headless construction or discovery took the execution lease: %v", err)
	}
}

func TestPluginToolActivationRejectsMissingLifecycle(t *testing.T) {
	if err := ActivatePluginToolsForBackend(nil, catalogBackend()); !errors.Is(err, runharness.ErrRootContextRequired) {
		t.Fatalf("missing context: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := ActivatePluginToolsForBackend(ctx, catalogBackend()); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled activation: %v", err)
	}
	if err := ActivatePluginToolsForBackend(context.Background(), catalogBackend()); err != nil {
		t.Fatalf("non-App backend changed behavior: %v", err)
	}
}
