package mcpserver

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/plugin"
)

func installCatalogSkillPackage(t *testing.T, body string) (*plugin.Manager, plugin.Status, context.Context) {
	t.Helper()
	packagePath := t.TempDir()
	manifest := plugin.Manifest{SchemaVersion: 1, APIVersion: 1, ID: "test.skills", Name: "Packaged skill tests", Version: "1.0.0", Permissions: []string{"ai.skills"},
		Contributes: plugin.Contributions{Skills: []plugin.Skill{{ID: "investigate", Name: "Investigate", Description: "Inspect supplied facts without changing data", Entry: "SKILL.md"}}}}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string][]byte{"gonavi.plugin.json": raw, "SKILL.md": []byte(body)} {
		if err := os.WriteFile(filepath.Join(packagePath, name), content, 0600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	manager, err := plugin.NewManager(plugin.Options{Root: t.TempDir()})
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cancel()
		cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		if err := manager.Close(cleanup); err != nil {
			t.Error(err)
		}
	})
	inspection, err := manager.Inspect(ctx, packagePath)
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.Install(ctx, plugin.InstallRequest{Path: packagePath, Digest: inspection.Digest, Trusted: true})
	if err != nil {
		t.Fatal(err)
	}
	return manager, status, ctx
}

func activeSkillCatalog(t *testing.T, body string) (*plugin.Manager, *PluginSkillCatalog, context.Context) {
	t.Helper()
	manager, status, ctx := installCatalogSkillPackage(t, body)
	if _, err := manager.SetEnabled(ctx, status.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	catalog := NewPluginSkillCatalog(func(context.Context) (*plugin.Manager, error) { return manager, nil })
	return manager, catalog, ctx
}

func firstSkillName(t *testing.T, ctx context.Context, catalog *PluginSkillCatalog) string {
	t.Helper()
	descriptors, err := catalog.List(ctx)
	if err != nil || len(descriptors) != 1 {
		t.Fatalf("cold skill snapshot: count=%d err=%v", len(descriptors), err)
	}
	return descriptors[0].Name
}

func fakeSkillStatus() plugin.Status {
	return plugin.Status{Manifest: plugin.Manifest{ID: "test.skills", Version: "1.0.0", Permissions: []string{"ai.skills"}, Contributes: plugin.Contributions{Skills: []plugin.Skill{{ID: "one", Name: "One", Description: "A skill summary", Entry: "SKILL.md"}}}}, Digest: strings.Repeat("a", 64), Generation: 2, State: plugin.StateRunning, DesiredEnabled: true}
}
