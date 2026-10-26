package cli

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/mcpserver"
	"GoNavi-Wails/internal/plugin"
)

func TestAgentPluginActivationRequiresWorkerOwnership(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	for _, workers := range []bool{false, true} {
		name := "read-only"
		if workers {
			name = "worker-owner"
		}
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			owner, err := defaultAgentHarnessFactory(ctx, AgentHarnessOptions{
				DataRoot: root, KeyFile: filepath.Join(root, "test-agent.key"), StartWorkers: workers,
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := owner.Close(); err != nil {
					t.Error(err)
				}
			})
			runtime, ok := owner.(*ledgerHarnessRuntime)
			if !ok {
				t.Fatal("unexpected Agent runtime")
			}
			// Discovery must not activate a read-only factory after construction.
			if _, err := mcpserver.NewPluginToolCatalogForBackend(runtime.backend).List(ctx); err != nil {
				t.Fatal(err)
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
			err = probe.Start(ctx)
			if workers {
				if !errors.Is(err, plugin.ErrLocked) {
					t.Fatalf("worker factory did not own plugin execution: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("read-only factory or descriptor lookup claimed plugin execution: %v", err)
			}
		})
	}
}

func TestAgentPluginActivationDoesNotStealExistingOwner(t *testing.T) {
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	root := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	existing, err := plugin.NewManager(plugin.Options{Root: filepath.Join(root, "plugins")})
	if err != nil {
		t.Fatal(err)
	}
	if err := existing.Start(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		if err := existing.Close(cleanup); err != nil {
			t.Error(err)
		}
	})
	owner, err := defaultAgentHarnessFactory(ctx, AgentHarnessOptions{DataRoot: root, KeyFile: filepath.Join(root, "test-agent.key"), StartWorkers: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := owner.Close(); err != nil {
			t.Error(err)
		}
	})
	if !existing.OwnsRuntime() {
		t.Fatal("Agent activation revoked an existing GUI owner")
	}
	runtime, ok := owner.(*ledgerHarnessRuntime)
	if !ok {
		t.Fatal("unexpected Agent runtime")
	}
	if tools, err := mcpserver.NewPluginToolCatalogForBackend(runtime.backend).List(ctx); err != nil || len(tools) != 0 {
		t.Fatalf("nonowner advertised plugin tools: %v %v", tools, err)
	}
}
