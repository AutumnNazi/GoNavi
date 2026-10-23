package market

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestArtifactPanelCellByteBudget(t *testing.T) {
	cell := func(n int) json.RawMessage {
		return json.RawMessage(`"` + strings.Repeat("a", n) + `"`)
	}
	manifest := artifactManifest{
		Contributes: artifactContributions{Panels: []artifactPanel{{
			ID: "main", Title: "Panel",
			Body: artifactUINode{Type: "table", Columns: []artifactColumn{{Key: "c", Title: "C"}}, Rows: []map[string]json.RawMessage{{"c": cell((256 << 10) - 3)}}},
		}}},
	}
	if err := validateArtifactContributions(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Contributes.Panels[0].Body.Rows[0]["c"] = cell((256 << 10) - 2)
	if validateArtifactContributions(manifest) == nil {
		t.Fatal("panel cells over 256 KiB were accepted")
	}
}
