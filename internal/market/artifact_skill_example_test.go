package market

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestExampleSkillArchivePassesMarketValidation(t *testing.T) {
	root := filepath.Join("..", "..", "examples", "plugins", "skills")
	archive := filepath.Join(t.TempDir(), "skills.zip")
	file, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for _, name := range []string{"gonavi.plugin.json", "skills/read-only-investigation/SKILL.md", "skills/read-only-investigation/REFERENCE.md"} {
		body, readErr := os.ReadFile(filepath.Join(root, filepath.FromSlash(name)))
		if readErr != nil {
			t.Fatal(readErr)
		}
		entry, createErr := writer.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, writeErr := entry.Write(body); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	if err = writer.Close(); err != nil || file.Close() != nil {
		t.Fatal(err)
	}
	validated, err := ValidatePackage(context.Background(), archive)
	if err != nil || validated.ID != "sdk.examples.skills" {
		t.Fatalf("%+v %v", validated, err)
	}
}
