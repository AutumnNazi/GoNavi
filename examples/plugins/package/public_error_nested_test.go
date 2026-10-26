package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStaticBuildHidesNestedUnknownField(t *testing.T) {
	name := strings.Repeat("文", 80)
	for _, body := range []string{
		`{"schemaVersion":1,"apiVersion":1,"id":"example.skills","name":"Skills","version":"1.0.0","permissions":["ai.skills"],"contributes":{"skills":[{"id":"guide","name":"Guide","description":"Read","entry":"skills/guide/SKILL.md"}],"panels":[{"id":"main","title":"Panel","body":{"type":"text","text":"ok","` + name + `":true}}]}}`,
		`{"schemaVersion":1,"apiVersion":1,"id":"example.skills","name":"Skills","version":"1.0.0","permissions":["ai.skills"],"contributes":{"skills":[{"id":"guide","name":"Guide","description":"Read","entry":"skills/guide/SKILL.md"}],"aiProviders":[{"id":"chat","name":"Chat","command":"ask","supportsTools":false,"supportsImages":false,"models":[{"id":"m","name":"M","contextWindow":1024,"maxOutputTokens":1,"` + name + `":true}]}]}}`,
	} {
		root := t.TempDir()
		manifest := filepath.Join(root, "gonavi.plugin.json")
		if err := os.WriteFile(manifest, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		err := buildStaticPackage(context.Background(), options{static: true, manifest: manifest, output: filepath.Join(t.TempDir(), "out")})
		if err == nil || strings.Contains(err.Error(), strings.Repeat("文", 40)) || strings.Contains(err.Error(), root) {
			t.Fatal(err)
		}
	}
}
