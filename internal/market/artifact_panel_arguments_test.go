package market

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestArtifactPanelArgumentByteBound(t *testing.T) {
	args := func(n int) json.RawMessage {
		return json.RawMessage(`{"k":"` + strings.Repeat("a", n) + `"}`)
	}
	manifest := artifactManifest{
		Backend: &artifactBackend{Default: &artifactEntry{Executable: "plugin"}},
		Contributes: artifactContributions{
			Commands: []artifactCommand{{ID: "run", Title: "Run"}},
			Panels:   []artifactPanel{{ID: "main", Title: "Panel", Body: artifactUINode{Type: "button", Command: "run", Arguments: args((64 << 10) - 8)}}},
		},
	}
	if err := validateArtifactContributions(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Contributes.Panels[0].Body.Arguments = args((64 << 10) - 7)
	if validateArtifactContributions(manifest) == nil {
		t.Fatal("button arguments over 64 KiB were accepted")
	}
}
