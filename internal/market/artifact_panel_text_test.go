package market

import (
	"strings"
	"testing"
)

func TestArtifactPanelTextByteBounds(t *testing.T) {
	panel := func(title, nodeTitle, text string) map[string]any {
		return map[string]any{"id": "main", "title": title, "body": map[string]any{"type": "text", "title": nodeTitle, "text": text}}
	}
	decoded, err := decodeArtifactManifest([]byte(artifactTestChange(t, func(fields map[string]any) {
		fields["contributes"] = map[string]any{"panels": []any{panel(strings.Repeat("中", 85), strings.Repeat("中", 341), strings.Repeat("文", 5461))}}
	})))
	if err != nil || validateArtifactContributions(decoded) != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ name, title, nodeTitle, text string }{
		{name: "text", title: "Panel", nodeTitle: "Title", text: strings.Repeat("文", 5462)},
		{name: "node", title: "Panel", nodeTitle: strings.Repeat("中", 342), text: "ok"},
		{name: "title", title: strings.Repeat("中", 86), nodeTitle: "Title", text: "ok"},
	} {
		t.Run(test.name, func(t *testing.T) {
			decoded, err = decodeArtifactManifest([]byte(artifactTestChange(t, func(fields map[string]any) {
				fields["contributes"] = map[string]any{"panels": []any{panel(test.title, test.nodeTitle, test.text)}}
			})))
			if err != nil || validateArtifactContributions(decoded) == nil {
				t.Fatal("overlong panel text was accepted")
			}
		})
	}
}
