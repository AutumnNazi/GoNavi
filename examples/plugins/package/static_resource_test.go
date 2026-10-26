package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStaticPackageCopiesDeclaredSkillResource(t *testing.T) {
	manifest := skillManifest()
	manifest.Contributes.Skills[0].Resources = []string{"skills/investigate/REFERENCE.md"}
	source := writeSkillSource(t, manifest, []byte("guide"))
	if err := os.WriteFile(filepath.Join(filepath.Dir(source), "skills", "investigate", "REFERENCE.md"), []byte("notes"), 0600); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "package")
	if err := buildPackage(context.Background(), options{static: true, manifest: source, output: output}); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(output, "skills", "investigate", "REFERENCE.md"))
	if err != nil || string(got) != "notes" {
		t.Fatalf("resource bytes: %q %v", got, err)
	}
	bad := skillManifest()
	bad.Contributes.Skills[0].Resources = []string{"skills/investigate/run.sh"}
	if err := validateStaticSkillResources(bad.Contributes.Skills[0].Entry, bad.Contributes.Skills[0].Resources); err == nil {
		t.Fatal("script resource was accepted")
	}
	missing := skillManifest()
	missing.Contributes.Skills[0].Resources = []string{"skills/investigate/REFERENCE.md"}
	missingSource := writeSkillSource(t, missing, []byte("guide"))
	missingOutput := filepath.Join(t.TempDir(), "package")
	if err := buildPackage(context.Background(), options{static: true, manifest: missingSource, output: missingOutput}); err == nil {
		t.Fatal("missing companion was packaged")
	}
	for _, body := range [][]byte{{}, {'a', 0}, bytes.Repeat([]byte{'x'}, maxStaticSkillBytes+1)} {
		badBytes := skillManifest()
		badBytes.Contributes.Skills[0].Resources = []string{"skills/investigate/REFERENCE.md"}
		badSource := writeSkillSource(t, badBytes, []byte("guide"))
		if err := os.WriteFile(filepath.Join(filepath.Dir(badSource), "skills", "investigate", "REFERENCE.md"), body, 0600); err != nil {
			t.Fatal(err)
		}
		if err := buildPackage(context.Background(), options{static: true, manifest: badSource, output: filepath.Join(t.TempDir(), "package")}); err == nil {
			t.Fatal("invalid companion was packaged")
		}
	}
}

func TestStaticPackageCompanionMultibyteBudget(t *testing.T) {
	for _, test := range []struct {
		name  string
		count int
		ok    bool
	}{
		{name: "exact", count: 21845, ok: true},
		{name: "over", count: 21846},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := []byte(strings.Repeat("文", test.count))
			manifest := skillManifest()
			manifest.Contributes.Skills[0].Resources = []string{"skills/investigate/REFERENCE.md"}
			source := writeSkillSource(t, manifest, []byte("guide"))
			if err := os.WriteFile(filepath.Join(filepath.Dir(source), "skills", "investigate", "REFERENCE.md"), body, 0o600); err != nil {
				t.Fatal(err)
			}
			output := filepath.Join(t.TempDir(), "package")
			err := buildPackage(context.Background(), options{static: true, manifest: source, output: output})
			if test.ok && err != nil {
				t.Fatal(err)
			}
			if !test.ok && (err == nil || strings.Contains(err.Error(), strings.Repeat("文", 40))) {
				t.Fatal(err)
			}
			if test.ok {
				got, err := os.ReadFile(filepath.Join(output, "skills", "investigate", "REFERENCE.md"))
				if err != nil || !bytes.Equal(got, body) {
					t.Fatalf("companion bytes changed: %v", err)
				}
			}
		})
	}
}
