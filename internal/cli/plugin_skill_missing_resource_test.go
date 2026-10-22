package cli

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPluginCheckRejectsMissingSkillResource(t *testing.T) {
	source := t.TempDir()
	manifest := `{"schemaVersion":1,"apiVersion":1,"id":"example.skills","name":"Skills","version":"1.0.0","permissions":["ai.skills"],"contributes":{"skills":[{"id":"guide","name":"Guide","description":"Read","entry":"skills/guide/SKILL.md","resources":["skills/guide/REFERENCE.md"]}]}}`
	for name, body := range map[string]string{"gonavi.plugin.json": manifest, "skills/guide/SKILL.md": "guide"} {
		target := filepath.Join(source, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var stdout, stderr bytes.Buffer
	if code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr); code == ExitSuccess {
		t.Fatalf("missing companion passed check: %s", stdout.String())
	}
	if stderr.Len() == 0 {
		t.Fatal("missing companion produced no error")
	}
}

func TestPluginCheckRejectsEmptyOrNULSkillResource(t *testing.T) {
	manifest := `{"schemaVersion":1,"apiVersion":1,"id":"example.skills","name":"Skills","version":"1.0.0","permissions":["ai.skills"],"contributes":{"skills":[{"id":"guide","name":"Guide","description":"Read","entry":"skills/guide/SKILL.md","resources":["skills/guide/REFERENCE.md"]}]}}`
	for _, body := range [][]byte{{}, {'x', 0}} {
		source := t.TempDir()
		files := map[string][]byte{"gonavi.plugin.json": []byte(manifest), "skills/guide/SKILL.md": []byte("guide"), "skills/guide/REFERENCE.md": body}
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
		if code == ExitSuccess || stderr.Len() == 0 {
			t.Fatalf("resource %q passed check: %s", body, stdout.String())
		}
	}
}
