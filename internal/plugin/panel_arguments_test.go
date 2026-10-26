package plugin

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPanelArgumentByteBound(t *testing.T) {
	args := func(n int) json.RawMessage {
		return json.RawMessage(`{"k":"` + strings.Repeat("a", n) + `"}`)
	}
	manifest := basicManifest("example.button")
	manifest.Backend = &Backend{Default: &Entry{Executable: "plugin"}}
	manifest.Contributes.Commands = []Command{{ID: "run", Title: "Run"}}
	manifest.Contributes.Panels = []Panel{{ID: "main", Title: "Panel", Body: UINode{Type: "button", Command: "run", Arguments: args((64 << 10) - 8)}}}
	if err := ValidateManifest(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Contributes.Panels[0].Body.Arguments = args((64 << 10) - 7)
	if ValidateManifest(manifest) == nil {
		t.Fatal("button arguments over 64 KiB were accepted")
	}
}
