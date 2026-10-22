package plugin

import (
	"fmt"
	"testing"
)

func TestContributionCountBounds(t *testing.T) {
	manifest := basicManifest("example.counts")
	manifest.Backend = &Backend{Default: &Entry{Executable: "plugin"}}
	for i := 0; i < 128; i++ {
		manifest.Contributes.Commands = append(manifest.Contributes.Commands, Command{ID: fmt.Sprintf("cmd%d", i), Title: "Run"})
	}
	for i := 0; i < 32; i++ {
		manifest.Contributes.Panels = append(manifest.Contributes.Panels, Panel{ID: fmt.Sprintf("panel%d", i), Title: "Panel", Body: UINode{Type: "text"}})
	}
	if err := ValidateManifest(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Contributes.Commands = append(manifest.Contributes.Commands, Command{ID: "extra", Title: "Run"})
	if ValidateManifest(manifest) == nil {
		t.Fatal("129 commands were accepted")
	}
	manifest.Contributes.Commands = manifest.Contributes.Commands[:128]
	manifest.Contributes.Panels = append(manifest.Contributes.Panels, Panel{ID: "extra", Title: "Panel", Body: UINode{Type: "text"}})
	if ValidateManifest(manifest) == nil {
		t.Fatal("33 panels were accepted")
	}
}
