package plugin

import (
	"strings"
	"testing"
)

func TestCommandDescriptionByteBound(t *testing.T) {
	manifest := basicManifest("example.commands")
	manifest.Backend = &Backend{Default: &Entry{Executable: "plugin"}}
	manifest.Contributes.Commands = []Command{{ID: "run", Title: "Run", Description: strings.Repeat("文", 1365)}}
	if err := ValidateManifest(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Contributes.Commands[0].Description = strings.Repeat("文", 1366)
	if ValidateManifest(manifest) == nil {
		t.Fatal("command description over 4096 bytes was accepted")
	}
}
