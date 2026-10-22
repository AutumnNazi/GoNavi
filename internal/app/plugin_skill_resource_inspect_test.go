package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectRejectsEmptySkillResource(t *testing.T) {
	a := newPluginTestApp(t)
	manifest := plugin.Manifest{SchemaVersion: 1, APIVersion: 1, ID: "example.skills", Name: "Skills", Version: "1.0.0",
		Permissions: []string{"ai.skills"},
		Contributes: plugin.Contributions{Skills: []plugin.Skill{{
			ID: "guide", Name: "Guide", Description: "Read", Entry: "skills/guide/SKILL.md",
			Resources: []string{"skills/guide/REFERENCE.md"},
		}}}}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range [][]byte{{}, {'x', 0}} {
		source := t.TempDir()
		files := map[string][]byte{"gonavi.plugin.json": raw, "skills/guide/SKILL.md": []byte("guide"), "skills/guide/REFERENCE.md": body}
		for name, content := range files {
			target := filepath.Join(source, filepath.FromSlash(name))
			if err = os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(target, content, 0o600); err != nil {
				t.Fatal(err)
			}
		}
		if result := a.PluginInspect(source); result.Success {
			t.Fatalf("desktop inspect accepted resource %q", body)
		}
	}
}
