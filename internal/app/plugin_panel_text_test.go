package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectPanelTextByteBounds(t *testing.T) {
	a := newPluginTestApp(t)
	for _, test := range []struct {
		name, title, nodeTitle, text, leak string
		ok                                 bool
	}{
		{name: "exact", ok: true, title: strings.Repeat("中", 85), nodeTitle: strings.Repeat("中", 341), text: strings.Repeat("文", 5461)},
		{name: "text", leak: "文", title: "Panel", nodeTitle: "Title", text: strings.Repeat("文", 5462)},
		{name: "node", leak: "中", title: "Panel", nodeTitle: strings.Repeat("中", 342), text: "ok"},
		{name: "title", leak: "中", title: strings.Repeat("中", 86), nodeTitle: "Title", text: "ok"},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.panel", Name: "Panel", Version: "1.0.0",
				Contributes: plugin.Contributions{Panels: []plugin.Panel{{
					ID: "main", Title: test.title, Body: plugin.UINode{Type: "text", Title: test.nodeTitle, Text: test.text},
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
				t.Fatalf("bounded panel rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, strings.Repeat(test.leak, 40)) || strings.Contains(result.Message, source)) {
				t.Fatalf("overlong panel: %+v", result)
			}
		})
	}
}
