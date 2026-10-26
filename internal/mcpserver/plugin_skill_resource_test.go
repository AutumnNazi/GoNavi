package mcpserver

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

func TestPluginSkillAgentLoadIgnoresCompanionMarkdown(t *testing.T) {
	const entry = "ENTRY_ONLY"
	const companion = "COMPANION_SENTINEL"
	packagePath := t.TempDir()
	manifest := plugin.Manifest{SchemaVersion: 1, APIVersion: 1, ID: "test.skills", Name: "Packaged skill tests", Version: "1.0.0", Permissions: []string{"ai.skills"},
		Contributes: plugin.Contributions{Skills: []plugin.Skill{{ID: "investigate", Name: "Investigate", Description: "Inspect supplied facts without changing data", Entry: "skills/investigate/SKILL.md", Resources: []string{"skills/investigate/REFERENCE.md"}}}}}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"gonavi.plugin.json": string(raw), "skills/investigate/SKILL.md": entry, "skills/investigate/REFERENCE.md": companion} {
		target := filepath.Join(packagePath, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(target, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	manager, err := plugin.NewManager(plugin.Options{Root: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		stop, done := context.WithTimeout(context.Background(), 3*time.Second)
		defer done()
		if err := manager.Close(stop); err != nil {
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
	if _, err = manager.SetEnabled(ctx, status.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if err = manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	catalog := NewPluginSkillCatalog(func(context.Context) (*plugin.Manager, error) { return manager, nil })
	listed, err := catalog.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	catalogJSON, err := json.Marshal(listed)
	if err != nil || strings.Contains(string(catalogJSON), "REFERENCE.md") || strings.Contains(string(catalogJSON), companion) {
		t.Fatalf("catalog advertised companion: %s", catalogJSON)
	}
	name := firstSkillName(t, ctx, catalog)
	_, executor, err := catalog.Resolve(ctx, name)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := executor.Execute(ctx, runharness.ToolExecutionRequest{ToolName: name, Effect: runharness.ToolEffectReadOnly, Arguments: json.RawMessage("{}")})
	if err != nil {
		t.Fatal(err)
	}
	resource, ok := loaded.Value.(pluginSkillResource)
	if !ok || resource.Resource.Content != entry || resource.Resource.Resource != "" {
		t.Fatalf("agent result included a companion: %+v", loaded.Value)
	}
	encoded, err := json.Marshal(loaded.Value)
	if err != nil || strings.Contains(string(encoded), companion) {
		t.Fatalf("encoded result leaked companion text: %s", encoded)
	}
}
