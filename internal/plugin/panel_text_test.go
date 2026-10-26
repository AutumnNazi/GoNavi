package plugin

import (
	"strings"
	"testing"
)

func TestPanelTextByteBounds(t *testing.T) {
	manifest := basicManifest("example.panel")
	manifest.Contributes.Panels = []Panel{{
		ID: "main", Title: strings.Repeat("中", 85),
		Body: UINode{Type: "text", Title: strings.Repeat("中", 341), Text: strings.Repeat("文", 5461)},
	}}
	if err := ValidateManifest(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Contributes.Panels[0].Body.Text = strings.Repeat("文", 5462)
	if ValidateManifest(manifest) == nil {
		t.Fatal("panel text over 16384 bytes was accepted")
	}
	manifest.Contributes.Panels[0].Body.Text = "ok"
	manifest.Contributes.Panels[0].Body.Title = strings.Repeat("中", 342)
	if ValidateManifest(manifest) == nil {
		t.Fatal("node title over 1024 bytes was accepted")
	}
	manifest.Contributes.Panels[0].Body.Title = "Title"
	manifest.Contributes.Panels[0].Title = strings.Repeat("中", 86)
	if ValidateManifest(manifest) == nil {
		t.Fatal("panel title over 256 bytes was accepted")
	}
}
