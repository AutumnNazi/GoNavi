package plugin

import (
	"strings"
	"testing"
)

func TestLocalIDBounds(t *testing.T) {
	manifest := basicManifest("example.host")
	manifest.Backend = &Backend{Default: &Entry{Executable: "plugin"}}
	manifest.Contributes.Commands = []Command{{ID: "run.now_1-A", Title: "Run"}}
	if err := ValidateManifest(manifest); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"-run", "run/now", "run now", strings.Repeat("a", 129)} {
		manifest.Contributes.Commands[0].ID = id
		if ValidateManifest(manifest) == nil {
			t.Fatalf("accepted %q", id)
		}
	}
	manifest.Contributes.Commands = []Command{{ID: "run", Title: "Run"}, {ID: "run", Title: "Again"}}
	if ValidateManifest(manifest) == nil {
		t.Fatal("duplicate command id was accepted")
	}
}
