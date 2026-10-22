package market

import (
	"context"
	"strings"
	"testing"
)

func TestArtifactSkillResourceMultibyteBudget(t *testing.T) {
	manifest := artifactSkillManifest(t, func(_ map[string]any, skill map[string]any) {
		skill["resources"] = []string{"skills/notes/REFERENCE.md"}
	})
	for _, test := range []struct {
		name  string
		count int
		ok    bool
	}{
		{name: "exact", count: 21845, ok: true},
		{name: "over", count: 21846},
	} {
		for _, format := range []string{".zip", ".tgz"} {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				body := []byte(strings.Repeat("文", test.count))
				entries := []artifactTestEntry{
					{name: artifactSkillTestEntry, body: []byte("guide")},
					{name: "skills/notes/REFERENCE.md", body: body},
					{name: artifactManifestName, body: []byte(manifest)},
				}
				filename := artifactTestWrite(t, format, artifactTestArchive(t, format, entries))
				_, err := ValidatePackage(context.Background(), filename)
				if test.ok && err != nil {
					t.Fatal(err)
				}
				if !test.ok && (err == nil || strings.Contains(err.Error(), strings.Repeat("文", 40))) {
					t.Fatal(err)
				}
			})
		}
	}
}
