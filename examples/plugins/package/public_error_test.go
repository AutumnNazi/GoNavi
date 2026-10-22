package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestStaticBuildHidesMissingManifestPath(t *testing.T) {
	root := t.TempDir()
	secret := filepath.Join(root, "secret-do-not-display", "gonavi.plugin.json")
	err := buildStaticPackage(context.Background(), options{static: true, manifest: secret, output: filepath.Join(t.TempDir(), "out")})
	err = publicPackageError(err, secret, filepath.Dir(secret), root)
	if err == nil || strings.Contains(err.Error(), "secret-do-not-display") || strings.Contains(err.Error(), root) {
		t.Fatal(err)
	}
}
