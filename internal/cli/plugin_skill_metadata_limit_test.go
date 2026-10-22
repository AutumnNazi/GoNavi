package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPluginCheckSkillMetadataByteBounds(t *testing.T) {
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
			raw, err := json.Marshal(map[string]any{
				"schemaVersion": 1, "apiVersion": 1, "id": "example.skills", "name": "Skills", "version": "1.0.0",
				"permissions": []string{"ai.skills"},
				"contributes": map[string]any{"skills": []map[string]any{{
					"id": "guide", "name": test.skillName, "description": test.description, "entry": "skills/guide/SKILL.md",
				}}},
			})
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
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			var stdout, stderr bytes.Buffer
			code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
			cancel()
			if test.ok && code != ExitSuccess {
				t.Fatalf("exact metadata failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), strings.Repeat("界", 40)) || strings.Contains(stderr.String(), source)) {
				t.Fatalf("overlong metadata: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}
