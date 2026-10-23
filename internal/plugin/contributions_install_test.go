package plugin

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeCombinedPackage(t *testing.T) string {
	t.Helper()
	manifest := basicManifest("example.bundle")
	manifest.Permissions = []string{"data.sources", "ai.skills", "ai.providers", "data.export"}
	manifest.Backend = &Backend{Default: &Entry{Executable: "plugin", Runtime: "native"}}
	manifest.Contributes.Commands = []Command{{ID: "db", Title: "DB"}, {ID: "chat", Title: "Chat"}, {ID: "render", Title: "Render"}}
	manifest.Contributes.DataSources = []DataSource{{ID: "db", Name: "DB", Dialect: "sqlite", Command: "db", ReadOnly: true}}
	manifest.Contributes.Skills = []Skill{{ID: "guide", Name: "Guide", Description: "Read", Entry: "skills/guide/SKILL.md", Resources: []string{"skills/guide/NOTES.md"}}}
	manifest.Contributes.AIProviders = []AIProvider{{ID: "chat", Name: "Chat", Command: "chat", Models: []AIModel{{ID: "model-a", Name: "Model", ContextWindow: 4096, MaxOutputTokens: 512}}, SupportsTools: true}}
	manifest.Contributes.Exporters = []Exporter{{ID: "ndjson", Name: "NDJSON", Command: "render", Extension: "ndjson", ContentType: "application/x-ndjson"}}
	source := t.TempDir()
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{"gonavi.plugin.json": string(raw), "plugin": "not executed", "skills/guide/SKILL.md": "guide", "skills/guide/NOTES.md": "notes"}
	for name, body := range files {
		target := filepath.Join(source, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(target, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return source
}

func TestCombinedPackageInstallStaysDisabled(t *testing.T) {
	source := writeCombinedPackage(t)
	root := t.TempDir()
	manager := managerAt(t, root)
	ctx := context.Background()
	inspection, err := manager.Inspect(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.Install(ctx, InstallRequest{Path: source, Digest: inspection.Digest, Trusted: true})
	if err != nil {
		t.Fatal(err)
	}
	if status.State != StateDisabled || status.DesiredEnabled || len(status.Manifest.Contributes.DataSources) != 1 || len(status.Manifest.Contributes.Exporters) != 1 {
		t.Fatalf("install started or dropped contributions: %+v", status)
	}
	stored, err := os.ReadFile(filepath.Join(root, "store", status.Digest, "skills", "guide", "NOTES.md"))
	if err != nil || string(stored) != "notes" {
		t.Fatalf("stored companion: %q %v", stored, err)
	}
}

func TestCombinedPackageFaultDoesNotBlockManager(t *testing.T) {
	source := writeCombinedPackage(t)
	manager := testManager(t)
	ctx := context.Background()
	inspection, err := manager.Inspect(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.Install(ctx, InstallRequest{Path: source, Digest: inspection.Digest, Trusted: true})
	if err != nil {
		t.Fatal(err)
	}
	enableFixture(t, manager, status.Manifest.ID)
	if err = manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	fault := waitState(t, manager, status.Manifest.ID, StateFaulted)
	if fault.LastError == "" || !fault.DesiredEnabled || len(manager.List()) != 1 {
		t.Fatalf("fault blocked manager: %+v", fault)
	}
	if _, err = manager.Inspect(ctx, source); err != nil {
		t.Fatal(err)
	}
	if _, err = manager.SetEnabled(ctx, status.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
}
