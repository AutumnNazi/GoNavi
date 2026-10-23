package plugin

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPanelCellByteBudget(t *testing.T) {
	cell := func(n int) json.RawMessage {
		return json.RawMessage(`"` + strings.Repeat("a", n) + `"`)
	}
	manifest := basicManifest("example.table")
	manifest.Contributes.Panels = []Panel{{
		ID: "main", Title: "Panel",
		Body: UINode{Type: "table", Columns: []Column{{Key: "c", Title: "C"}}, Rows: []map[string]json.RawMessage{{"c": cell((256 << 10) - 3)}}},
	}}
	if err := ValidateManifest(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Contributes.Panels[0].Body.Rows[0]["c"] = cell((256 << 10) - 2)
	if ValidateManifest(manifest) == nil {
		t.Fatal("panel cells over 256 KiB were accepted")
	}
}
