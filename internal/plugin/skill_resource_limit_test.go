package plugin

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSkillResourceSharesEntrySizeLimit(t *testing.T) {
	manifest := skillManifest()
	manifest.Contributes.Skills[0].Resources = []string{"skills/guide/REFERENCE.md"}
	for _, test := range []struct {
		name  string
		body  []byte
		valid bool
	}{
		{name: "oversized", body: []byte(strings.Repeat("x", maxSkillBytes+1)), valid: false},
		{name: "exact", body: []byte(strings.Repeat("x", maxSkillBytes)), valid: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			directory := skillPackage(t, manifest, []byte("# guide\n"))
			target := filepath.Join(directory, "skills", "guide", "REFERENCE.md")
			if err := os.WriteFile(target, test.body, 0o600); err != nil {
				t.Fatal(err)
			}
			_, err := InspectPackage(context.Background(), directory)
			if (err == nil) != test.valid {
				t.Fatalf("accepted=%v want %v: %v", err == nil, test.valid, err)
			}
		})
	}
}

func TestSkillResourceReadKeepsExactSize(t *testing.T) {
	manager := testManager(t)
	manifest := skillManifest()
	manifest.Contributes.Skills[0].Resources = []string{"skills/guide/REFERENCE.md"}
	body := strings.Repeat("x", maxSkillBytes)
	directory := skillPackage(t, manifest, []byte("guide"))
	if err := os.WriteFile(filepath.Join(directory, "skills", "guide", "REFERENCE.md"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	status := installSource(t, manager, directory)
	enableFixture(t, manager, status.Manifest.ID)
	if err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	status = waitState(t, manager, status.Manifest.ID, StateRunning)
	got, err := manager.ReadSkillResourceGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest, "skills/guide/REFERENCE.md")
	if err != nil || got.Content != body || got.Resource != "skills/guide/REFERENCE.md" {
		t.Fatalf("len=%d err=%v", len(got.Content), err)
	}
	entry, err := manager.ReadSkillGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest)
	if err != nil || entry.Content != "guide" || strings.Contains(entry.Content, "xxx") {
		t.Fatalf("entry %+v %v", entry, err)
	}
}
