package plugin

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSkillResourceReadIsExplicit(t *testing.T) {
	manager := testManager(t)
	manifest := skillManifest()
	manifest.Contributes.Skills[0].Resources = []string{"skills/guide/REFERENCE.md"}
	directory := skillPackage(t, manifest, []byte("guide"))
	if err := os.WriteFile(filepath.Join(directory, "skills", "guide", "REFERENCE.md"), []byte("reference"), 0600); err != nil {
		t.Fatal(err)
	}
	status := installSource(t, manager, directory)
	enableFixture(t, manager, status.Manifest.ID)
	if err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	status = waitState(t, manager, status.Manifest.ID, StateRunning)
	got, err := manager.ReadSkillResourceGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest, "skills/guide/REFERENCE.md")
	if err != nil || got.Content != "reference" || got.Resource != "skills/guide/REFERENCE.md" {
		t.Fatalf("%+v %v", got, err)
	}
	body, err := manager.ReadSkillGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest)
	if err != nil || body.Content != "guide" || body.Resource != "" {
		t.Fatalf("entry read %+v %v", body, err)
	}
	for _, resource := range []string{"skills/guide/SKILL.md", "../SECRET.md"} {
		if _, err = manager.ReadSkillResourceGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest, resource); !errors.Is(err, ErrNotFound) {
			t.Fatalf("%s: %v", resource, err)
		}
	}
}

func TestSkillResourceMustBePackagedMarkdown(t *testing.T) {
	manifest := skillManifest()
	manifest.Contributes.Skills[0].Resources = []string{"skills/guide/REFERENCE.md"}
	directory := skillPackage(t, manifest, []byte("guide"))
	target := filepath.Join(directory, "skills", "guide", "REFERENCE.md")
	if err := os.WriteFile(target, []byte("reference"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectPackage(context.Background(), directory); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectPackage(context.Background(), directory); err == nil {
		t.Fatal("missing skill resource was accepted")
	}
	rejected := skillManifest()
	rejected.Contributes.Skills[0].Resources = []string{"skills/guide/run.sh"}
	if ValidateManifest(rejected) == nil {
		t.Fatal("script resource was accepted")
	}
}

func TestSkillResourceRejectsEmptyAndNUL(t *testing.T) {
	for _, body := range [][]byte{nil, {'n', 0}} {
		manifest := skillManifest()
		manifest.Contributes.Skills[0].Resources = []string{"skills/guide/REFERENCE.md"}
		directory := skillPackage(t, manifest, []byte("guide"))
		target := filepath.Join(directory, "skills", "guide", "REFERENCE.md")
		if err := os.WriteFile(target, body, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := InspectPackage(context.Background(), directory); err == nil {
			t.Fatalf("accepted resource %q", body)
		}
	}
}
