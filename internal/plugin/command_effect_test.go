package plugin

import "testing"

func TestCommandEffectBounds(t *testing.T) {
	manifest := basicManifest("example.host")
	manifest.Backend = &Backend{Default: &Entry{Executable: "plugin"}}
	for _, effect := range []string{"", "read", "write", "unknown"} {
		manifest.Contributes.Commands = []Command{{ID: "run", Title: "Run", Effect: effect}}
		if err := ValidateManifest(manifest); err != nil {
			t.Fatal(effect, err)
		}
	}
	for _, effect := range []string{"WRITE", "sideeffect", "Read"} {
		manifest.Contributes.Commands[0].Effect = effect
		if ValidateManifest(manifest) == nil {
			t.Fatalf("accepted %s", effect)
		}
	}
}
