package market

import (
	"fmt"
	"testing"
)

func TestArtifactContributionCountBounds(t *testing.T) {
	commands := make([]any, 128)
	for i := range commands {
		commands[i] = map[string]any{"id": fmt.Sprintf("cmd%d", i), "title": "Run"}
	}
	panels := make([]any, 32)
	for i := range panels {
		panels[i] = map[string]any{"id": fmt.Sprintf("panel%d", i), "title": "Panel", "body": map[string]any{"type": "text", "text": "Status"}}
	}
	decoded, err := decodeArtifactManifest([]byte(artifactTestChange(t, func(fields map[string]any) {
		fields["contributes"] = map[string]any{"commands": commands, "panels": panels}
	})))
	if err != nil || validateArtifactContributions(decoded) != nil {
		t.Fatal(err)
	}
	commands = append(commands, map[string]any{"id": "extra", "title": "Run"})
	decoded, err = decodeArtifactManifest([]byte(artifactTestChange(t, func(fields map[string]any) {
		fields["contributes"] = map[string]any{"commands": commands}
	})))
	if err != nil || validateArtifactContributions(decoded) == nil {
		t.Fatal("129 commands were accepted")
	}
	panels = append(panels, map[string]any{"id": "extra", "title": "Panel", "body": map[string]any{"type": "text", "text": "Status"}})
	decoded, err = decodeArtifactManifest([]byte(artifactTestChange(t, func(fields map[string]any) {
		fields["contributes"] = map[string]any{"panels": panels}
	})))
	if err != nil || validateArtifactContributions(decoded) == nil {
		t.Fatal("33 panels were accepted")
	}
}
