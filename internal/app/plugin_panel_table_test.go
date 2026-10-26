package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectPanelTableCounts(t *testing.T) {
	a := newPluginTestApp(t)
	columns := make([]plugin.Column, 32)
	for i := range columns {
		columns[i] = plugin.Column{Key: fmt.Sprintf("c%d", i), Title: "C"}
	}
	rows := make([]map[string]json.RawMessage, 500)
	for i := range rows {
		rows[i] = map[string]json.RawMessage{}
	}
	for _, test := range []struct {
		name string
		body plugin.UINode
		ok   bool
	}{
		{name: "exact", ok: true, body: plugin.UINode{Type: "table", Columns: columns, Rows: rows}},
		{name: "columns", ok: false, body: plugin.UINode{Type: "table", Columns: append(append([]plugin.Column{}, columns...), plugin.Column{Key: "extra", Title: "C"})}},
		{name: "rows", ok: false, body: plugin.UINode{Type: "table", Columns: columns[:1], Rows: append(append([]map[string]json.RawMessage{}, rows...), map[string]json.RawMessage{})}},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.table", Name: "Table", Version: "1.0.0",
				Contributes: plugin.Contributions{Panels: []plugin.Panel{{ID: "main", Title: "Panel", Body: test.body}}},
			})
			if err != nil {
				t.Fatal(err)
			}
			source := t.TempDir()
			if err = os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), raw, 0o600); err != nil {
				t.Fatal(err)
			}
			result := a.PluginInspect(source)
			if test.ok && !result.Success {
				t.Fatalf("bounded table rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, source)) {
				t.Fatalf("table count: %+v", result)
			}
		})
	}
}
