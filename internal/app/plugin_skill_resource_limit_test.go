package app

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectSkillResourceSizeLimit(t *testing.T) {
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
	for _, test := range []struct {
		name string
		body []byte
		ok   bool
	}{
		{name: "exact", body: bytes.Repeat([]byte{'x'}, 64<<10), ok: true},
		{name: "over", body: bytes.Repeat([]byte{'x'}, 64<<10+1), ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := t.TempDir()
			files := map[string][]byte{"gonavi.plugin.json": raw, "skills/guide/SKILL.md": []byte("guide"), "skills/guide/REFERENCE.md": test.body}
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
				t.Fatalf("exact companion rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, strings.Repeat("x", 32)) || strings.Contains(result.Message, source)) {
				t.Fatalf("oversized companion: %+v", result)
			}
		})
	}
}
