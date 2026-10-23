package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginSkillResourceReadKeepsMultibyteSize(t *testing.T) {
	body := []byte(strings.Repeat("文", 21845))
	if len(body) != (64<<10)-1 {
		t.Fatal(len(body))
	}
	fixture := newPluginSkillFixtureWithResource(t, body)
	status := startPluginSkillFixture(t, fixture)
	resource := "skills/investigate/REFERENCE.md"
	result := fixture.app.PluginSkillResourceRead(status.Manifest.ID, "investigate", status.Digest, resource, status.Generation)
	value, ok := result.Data.(plugin.SkillContent)
	if !result.Success || !ok || value.Content != string(body) {
		t.Fatalf("len=%d success=%t", len(value.Content), result.Success)
	}
}

func TestPluginSkillInspectRejectsMultibyteOversize(t *testing.T) {
	body := []byte(strings.Repeat("文", 21846))
	if len(body) <= 64<<10 {
		t.Fatal(len(body))
	}
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
	if err := os.WriteFile(filepath.Join(root, "skills", "investigate", "REFERENCE.md"), body, 0o600); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "gonavi.plugin.json"), encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	manager := newPluginSkillController(t, a)
	_, err = manager.Inspect(a.ctx, root)
	if err == nil || strings.Contains(err.Error(), strings.Repeat("文", 40)) || strings.Contains(err.Error(), root) {
		t.Fatal(err)
	}
}
