package market

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestValidateShippedStaticSkillExample(t *testing.T) {
	root := filepath.Join("..", "..", "examples", "plugins", "skills")
	names := []string{"gonavi.plugin.json", "skills/read-only-investigation/SKILL.md", "skills/read-only-investigation/REFERENCE.md"}
	entries := make([]artifactTestEntry, 0, len(names))
	for _, name := range names {
		body, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(name)))
		if err != nil {
			t.Fatal(err)
		}
		entries = append(entries, artifactTestEntry{name: name, body: body})
	}
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format, func(t *testing.T) {
			file := artifactTestWrite(t, format, artifactTestArchive(t, format, entries))
			got, err := ValidatePackage(context.Background(), file)
			if err != nil || got.ID != "sdk.examples.skills" || len(got.Platforms) != 1 || got.Platforms[0] != "any" {
				t.Fatalf("%+v %v", got, err)
			}
		})
	}
}
