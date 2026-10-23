package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectColumnByteBounds(t *testing.T) {
	a := newPluginTestApp(t)
	for _, test := range []struct {
		name, key, title string
		ok               bool
	}{
		{name: "exact", ok: true, key: strings.Repeat("中", 42), title: strings.Repeat("中", 85)},
		{name: "key", key: strings.Repeat("中", 43), title: "C"},
		{name: "title", key: "c", title: strings.Repeat("中", 86)},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.table", Name: "Table", Version: "1.0.0",
				Contributes: plugin.Contributions{Panels: []plugin.Panel{{
					ID: "main", Title: "Panel",
					Body: plugin.UINode{Type: "table", Columns: []plugin.Column{{Key: test.key, Title: test.title}}},
				}}},
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
				t.Fatalf("bounded column rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, strings.Repeat("中", 40)) || strings.Contains(result.Message, source)) {
				t.Fatalf("column bound: %+v", result)
			}
		})
	}
}
