package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/plugin"
)

const pluginSkillTestBody = "# Read-only investigation\n\nInspect existing evidence before proposing a query.\n"
const pluginSkillResourceBody = "Reference notes stay outside the agent prompt.\n"

type pluginSkillFixture struct {
	app        *App
	manager    *plugin.Manager
	inspection plugin.Inspection
	bodyPath   string
}

func newPluginSkillFixture(t *testing.T) pluginSkillFixture {
	return newPluginSkillFixtureWithResource(t, []byte(pluginSkillResourceBody))
}

func newPluginSkillFixtureWithResource(t *testing.T, resource []byte) pluginSkillFixture {
	t.Helper()
	t.Setenv("GONAVI_DISABLE_PLUGINS", "")
	a := newPluginTestApp(t)
	root := t.TempDir()
	manifest := pluginSkillTestManifest()
	entry := manifest.Contributes.Skills[0].Entry
	if err := os.MkdirAll(filepath.Dir(filepath.Join(root, entry)), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, entry), []byte(pluginSkillTestBody), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "skills", "investigate", "REFERENCE.md"), resource, 0o600); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "gonavi.plugin.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	manager := newPluginSkillController(t, a)
	inspection, err := manager.Inspect(a.ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Install(a.ctx, plugin.InstallRequest{Path: root, Digest: inspection.Digest, Trusted: true}); err != nil {
		t.Fatal(err)
	}
	if inspection.Manifest.Backend != nil || inspection.Manifest.Window != nil || manager.OwnsRuntime() {
		t.Fatal("static skill fixture acquired execution resources")
	}
	return pluginSkillFixture{app: a, manager: manager, inspection: inspection,
		bodyPath: filepath.Join(a.configDir, "plugins", "store", inspection.Digest, entry)}
}

func pluginSkillTestManifest() plugin.Manifest {
	return plugin.Manifest{
		SchemaVersion: 1, APIVersion: 1, ID: "test.skills", Name: "Packaged skills", Version: "1.0.0",
		Permissions: []string{"ai.skills"},
		Contributes: plugin.Contributions{Skills: []plugin.Skill{{
			ID: "investigate", Name: "Investigate", Description: "Review existing database evidence", Entry: "skills/investigate/SKILL.md", Resources: []string{"skills/investigate/REFERENCE.md"},
		}}},
	}
}

func newPluginSkillController(t *testing.T, a *App) *plugin.Manager {
	t.Helper()
	manager, err := plugin.NewManager(plugin.Options{Root: filepath.Join(a.configDir, "plugins"), HostVersion: CurrentVersion()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := manager.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	return manager
}

func attachPluginSkillController(a *App, manager *plugin.Manager) {
	a.plugins.mu.Lock()
	defer a.plugins.mu.Unlock()
	a.plugins.manager = manager
	a.plugins.root = filepath.Join(a.configDir, "plugins")
}

func startPluginSkillFixture(t *testing.T, fixture pluginSkillFixture) plugin.Status {
	t.Helper()
	if _, err := fixture.manager.SetEnabled(fixture.app.ctx, fixture.inspection.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := fixture.manager.Start(fixture.app.ctx); err != nil {
		t.Fatal(err)
	}
	attachPluginSkillController(fixture.app, fixture.manager)
	return waitPluginSkillState(t, fixture, plugin.StateRunning)
}

func waitPluginSkillState(t *testing.T, fixture pluginSkillFixture, state plugin.State) plugin.Status {
	t.Helper()
	ctx, cancel := context.WithTimeout(fixture.app.ctx, 3*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		for _, status := range fixture.manager.List() {
			if status.Manifest.ID == fixture.inspection.Manifest.ID && status.State == state {
				return status
			}
		}
		select {
		case <-ctx.Done():
			t.Fatalf("skill fixture did not reach %s: %v", state, ctx.Err())
			return plugin.Status{}
		case <-ticker.C:
		}
	}
}

func pluginSkillCatalogResult(t *testing.T, result connection.QueryResult) PluginSkillCatalog {
	t.Helper()
	catalog, ok := result.Data.(PluginSkillCatalog)
	if !result.Success || !ok || catalog.Items == nil {
		t.Fatalf("invalid skill catalog: success=%t type=%T", result.Success, result.Data)
	}
	return catalog
}

func requirePluginSkillFailure(t *testing.T, result connection.QueryResult, code string) {
	t.Helper()
	data, ok := result.Data.(map[string]any)
	if result.Success || !ok || data["code"] != code || result.Message == "" || len(data) != 1 {
		t.Fatalf("unsafe or unexpected failure: success=%t code=%v", result.Success, data["code"])
	}
}

func requirePluginSkillNoStartup(t *testing.T, a *App) {
	t.Helper()
	a.plugins.mu.Lock()
	uninitialized := a.plugins.manager == nil && a.plugins.initializing == nil && a.plugins.lifetime == nil && a.plugins.cancel == nil
	a.plugins.mu.Unlock()
	if !uninitialized {
		t.Fatal("skill discovery or read initialized App plugin execution")
	}
	if _, err := os.Stat(filepath.Join(a.configDir, "plugins", ".runtime.lock")); !os.IsNotExist(err) {
		t.Fatalf("skill discovery or read touched the runtime lease: %v", err)
	}
}
