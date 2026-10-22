package market

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestArtifactSkillResourceRejectsEmptyAndNUL(t *testing.T) {
	manifest := artifactSkillManifest(t, func(_ map[string]any, skill map[string]any) {
		skill["resources"] = []string{"skills/notes/REFERENCE.md"}
	})
	for _, body := range [][]byte{{}, append([]byte("SECRET_RESOURCE"), 0), bytes.Repeat([]byte{'x'}, maxArtifactSkillBytes+1)} {
		entries := []artifactTestEntry{
			{name: artifactSkillTestEntry, body: []byte("guide")},
			{name: "skills/notes/REFERENCE.md", body: body},
			{name: artifactManifestName, body: []byte(manifest)},
		}
		filename := artifactTestWrite(t, ".zip", artifactTestArchive(t, ".zip", entries))
		_, err := ValidatePackage(context.Background(), filename)
		if err == nil || strings.Contains(err.Error(), "SECRET_RESOURCE") {
			t.Fatalf("resource %q: %v", body, err)
		}
	}
}
