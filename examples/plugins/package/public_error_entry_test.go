package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStaticBuildHidesMissingMultibyteEntry(t *testing.T) {
	root := t.TempDir()
	manifestValue := skillManifest()
	manifestValue.Contributes.Skills[0].Entry = strings.Repeat("文", 80) + "/SKILL.md"
	raw, err := json.Marshal(manifestValue)
	if err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(root, "gonavi.plugin.json")
	if err = os.WriteFile(manifest, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	err = buildStaticPackage(context.Background(), options{static: true, manifest: manifest, output: filepath.Join(t.TempDir(), "out")})
	if err == nil || strings.Contains(err.Error(), strings.Repeat("文", 40)) || strings.Contains(err.Error(), root) {
		t.Fatal(err)
	}
}
