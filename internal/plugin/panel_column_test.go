package plugin

import (
	"strings"
	"testing"
)

func TestPanelColumnByteBounds(t *testing.T) {
	manifest := basicManifest("example.table")
	manifest.Contributes.Panels = []Panel{{
		ID: "main", Title: "Panel",
		Body: UINode{Type: "table", Columns: []Column{{Key: strings.Repeat("中", 42), Title: strings.Repeat("中", 85)}}},
	}}
	if err := ValidateManifest(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Contributes.Panels[0].Body.Columns[0].Key = strings.Repeat("中", 43)
	if ValidateManifest(manifest) == nil {
		t.Fatal("column key over 128 bytes was accepted")
	}
	manifest.Contributes.Panels[0].Body.Columns[0].Key = "c"
	manifest.Contributes.Panels[0].Body.Columns[0].Title = strings.Repeat("中", 86)
	if ValidateManifest(manifest) == nil {
		t.Fatal("column title over 256 bytes was accepted")
	}
}
