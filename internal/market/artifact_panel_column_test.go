package market

import (
	"strings"
	"testing"
)

func TestArtifactPanelColumnByteBounds(t *testing.T) {
	panel := func(key, title string) artifactManifest {
		return artifactManifest{Contributes: artifactContributions{Panels: []artifactPanel{{
			ID: "main", Title: "Panel",
			Body: artifactUINode{Type: "table", Columns: []artifactColumn{{Key: key, Title: title}}},
		}}}}
	}
	if err := validateArtifactContributions(panel(strings.Repeat("中", 42), strings.Repeat("中", 85))); err != nil {
		t.Fatal(err)
	}
	if validateArtifactContributions(panel(strings.Repeat("中", 43), "C")) == nil {
		t.Fatal("column key over 128 bytes was accepted")
	}
	if validateArtifactContributions(panel("c", strings.Repeat("中", 86))) == nil {
		t.Fatal("column title over 256 bytes was accepted")
	}
}
