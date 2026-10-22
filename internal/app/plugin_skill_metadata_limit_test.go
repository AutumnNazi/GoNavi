package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectSkillMetadataByteBounds(t *testing.T) {
	a := newPluginTestApp(t)
	for _, test := range []struct {
		name        string
		skillName   string
		description string
		ok          bool
	}{
		{name: "exact", skillName: strings.Repeat("界", 85), description: strings.Repeat("界", 682), ok: true},
		{name: "name", skillName: strings.Repeat("界", 86), description: "Read", ok: false},
		{name: "description", skillName: "Guide", description: strings.Repeat("界", 683), ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			manifest := plugin.Manifest{SchemaVersion: 1, APIVersion: 1, ID: "example.skills", Name: "Skills", Version: "1.0.0",
				Permissions: []string{"ai.skills"},
				Contributes: plugin.Contributions{Skills: []plugin.Skill{{
					ID: "guide", Name: test.skillName, Description: test.description, Entry: "skills/guide/SKILL.md",
				}}}}
			raw, err := json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			source := t.TempDir()
			files := map[string][]byte{"gonavi.plugin.json": raw, "skills/guide/SKILL.md": []byte("guide")}
			for name, content := range files {
				target := filepath.Join(source, filepath.FromSlash(name))
				if err = os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(target, content, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			result := a.PluginInspect(source)
			if test.ok && !result.Success {
				t.Fatalf("exact metadata rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, strings.Repeat("界", 40)) || strings.Contains(result.Message, source)) {
				t.Fatalf("overlong metadata: %+v", result)
			}
		})
	}
}
