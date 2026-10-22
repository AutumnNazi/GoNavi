package mcpserver

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginToolCatalogRealDataSourceCannotBeAdvertisedOrResolved(t *testing.T) {
	directory := buildCatalogPackage(t, "./read-only-database", "./read-only-database/gonavi.plugin.json")
	manifestPath := filepath.Join(directory, "gonavi.plugin.json")
	original, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := plugin.ParseManifest(original)
	if err != nil {
		t.Fatal(err)
	}
	// Even explicit Agent opt-in cannot re-grant reserved driver command authority.
	manifest.Permissions = append(manifest.Permissions, "ai.tools")
	content, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(manifestPath, content, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, manager, catalog := openCatalogPackage(t, directory)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	var running plugin.Status
	for running.State != plugin.StateRunning {
		for _, status := range manager.List() {
			if status.Manifest.ID == manifest.ID {
				running = status
				break
			}
		}
		if running.State == plugin.StateFaulted {
			t.Fatal("real datasource backend failed startup")
		}
		if running.State == plugin.StateRunning {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
	descriptors, err := catalog.List(ctx)
	if err != nil || len(descriptors) != 0 {
		t.Fatalf("driver command exposed to Agent: %+v %v", descriptors, err)
	}
	command := running.Manifest.Contributes.Commands[0]
	name := newPluginToolBinding(running, command).descriptor.Name
	if _, _, err = catalog.Resolve(ctx, name); !errors.Is(err, ErrAgentToolNotFound) {
		t.Fatalf("forged Agent alias resolved driver: %v", err)
	}
	args := json.RawMessage(`{"protocolVersion":1,"operation":"connect","sessionId":"forged-session"}`)
	if _, err = manager.InvokeGeneration(ctx, manifest.ID, running.Generation, command.ID, args); !errors.Is(err, plugin.ErrDataSourceCommandReserved) {
		t.Fatalf("generic runtime re-granted driver authority: %v", err)
	}
}
