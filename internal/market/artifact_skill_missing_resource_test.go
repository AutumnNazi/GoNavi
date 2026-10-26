package market

import (
	"context"
	"testing"
)

func TestArtifactSkillArchiveRejectsMissingResource(t *testing.T) {
	manifest := artifactSkillManifest(t, func(_ map[string]any, skill map[string]any) {
		skill["resources"] = []string{"skills/notes/REFERENCE.md"}
	})
	filename, _ := artifactSkillArchive(t, ".zip", manifest, artifactSkillTestEntry, []byte("guide"))
	if _, err := ValidatePackage(context.Background(), filename); err == nil {
		t.Fatal("missing companion was accepted")
	}
}
