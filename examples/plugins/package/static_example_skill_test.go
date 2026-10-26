package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func TestExampleSkillManifestUsesSDKResourceCheck(t *testing.T) {
	manifestPath := filepath.Join("..", "skills", "gonavi.plugin.json")
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest plugin.Manifest
	if err = json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.ID != "sdk.examples.skills" || manifest.Contributes == nil || len(manifest.Contributes.Skills) != 1 {
		t.Fatal("example skill manifest changed")
	}
	skill := manifest.Contributes.Skills[0]
	if err = plugin.ValidateSkillResources(skill); err != nil {
		t.Fatal(err)
	}
	if len(skill.Resources) != 1 || skill.Resources[0] != "skills/read-only-investigation/REFERENCE.md" {
		t.Fatalf("companion: %#v", skill.Resources)
	}
	if _, err = os.Stat(filepath.Join(filepath.Dir(manifestPath), filepath.FromSlash(skill.Resources[0]))); err != nil {
		t.Fatal(err)
	}
}

func TestExampleSkillPackageCopiesCompanion(t *testing.T) {
	source, err := filepath.Abs(filepath.Join("..", "skills", "gonavi.plugin.json"))
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "package")
	if err = buildPackage(context.Background(), options{static: true, manifest: source, output: output}); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"skills/read-only-investigation/SKILL.md", "skills/read-only-investigation/REFERENCE.md"} {
		expected, err := os.ReadFile(filepath.Join(filepath.Dir(source), filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		actual, err := os.ReadFile(filepath.Join(output, filepath.FromSlash(rel)))
		if err != nil || !bytes.Equal(expected, actual) || len(actual) == 0 || len(actual) > maxStaticSkillBytes {
			t.Fatalf("packaged %s: %d %v", rel, len(actual), err)
		}
	}
}
