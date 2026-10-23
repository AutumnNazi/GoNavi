package plugin

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestPanelTableCountBounds(t *testing.T) {
	columns := make([]Column, 32)
	for i := range columns {
		columns[i] = Column{Key: fmt.Sprintf("c%d", i), Title: "C"}
	}
	rows := make([]map[string]json.RawMessage, 500)
	for i := range rows {
		rows[i] = map[string]json.RawMessage{}
	}
	manifest := basicManifest("example.table")
	manifest.Contributes.Panels = []Panel{{ID: "main", Title: "Panel", Body: UINode{Type: "table", Columns: columns, Rows: rows}}}
	if err := ValidateManifest(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Contributes.Panels[0].Body.Columns = append(columns, Column{Key: "extra", Title: "C"})
	if ValidateManifest(manifest) == nil {
		t.Fatal("33 columns were accepted")
	}
	manifest.Contributes.Panels[0].Body.Columns = columns
	manifest.Contributes.Panels[0].Body.Rows = append(rows, map[string]json.RawMessage{})
	if ValidateManifest(manifest) == nil {
		t.Fatal("501 rows were accepted")
	}
}
