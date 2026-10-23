package cli

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPluginCheckSkillResourceSizeLimit(t *testing.T) {
	manifest := `{"schemaVersion":1,"apiVersion":1,"id":"example.skills","name":"Skills","version":"1.0.0","permissions":["ai.skills"],"contributes":{"skills":[{"id":"guide","name":"Guide","description":"Read","entry":"skills/guide/SKILL.md","resources":["skills/guide/REFERENCE.md"]}]}}`
	for _, test := range []struct {
		name string
		body []byte
		ok   bool
	}{
		{name: "exact", body: bytes.Repeat([]byte{'x'}, 64<<10), ok: true},
		{name: "over", body: bytes.Repeat([]byte{'x'}, 64<<10+1), ok: false},
		{name: "multibyte", body: []byte(strings.Repeat("文", 21845)), ok: true},
		{name: "multibyte over", body: []byte(strings.Repeat("文", 21846)), ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := t.TempDir()
			files := map[string][]byte{"gonavi.plugin.json": []byte(manifest), "skills/guide/SKILL.md": []byte("guide"), "skills/guide/REFERENCE.md": test.body}
			for name, content := range files {
				target := filepath.Join(source, filepath.FromSlash(name))
				if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(target, content, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			var stdout, stderr bytes.Buffer
			code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
			cancel()
			leaked := strings.Contains(stdout.String()+stderr.String(), strings.Repeat("文", 40)) || strings.Contains(stderr.String(), strings.Repeat("x", 32))
			if test.ok && (code != ExitSuccess || leaked) {
				t.Fatalf("exact companion failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), source) || leaked) {
				t.Fatalf("oversized companion: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}
