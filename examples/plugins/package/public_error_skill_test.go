package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStaticBuildHidesMissingSkillPath(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "secret-do-not-display")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(skillManifest())
	if err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(dir, "gonavi.plugin.json")
	if err = os.WriteFile(manifest, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	err = buildStaticPackage(context.Background(), options{static: true, manifest: manifest, output: filepath.Join(t.TempDir(), "out")})
	err = publicPackageError(err, manifest, dir, root)
	if err == nil || strings.Contains(err.Error(), "secret-do-not-display") || strings.Contains(err.Error(), root) {
		t.Fatal(err)
	}
}
