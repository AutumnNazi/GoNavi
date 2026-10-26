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

func TestPluginInspectContributionCounts(t *testing.T) {
	a := newPluginTestApp(t)
	for _, test := range []struct {
		name     string
		commands int
		panels   int
		ok       bool
	}{
		{name: "exact", commands: 128, panels: 32, ok: true},
		{name: "commands", commands: 129, panels: 0, ok: false},
		{name: "panels", commands: 0, panels: 33, ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			manifest := plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.counts", Name: "Counts", Version: "1.0.0",
				Backend: &plugin.Backend{Default: &plugin.Entry{Executable: "plugin", Runtime: "native"}},
			}
			for i := 0; i < test.commands; i++ {
				manifest.Contributes.Commands = append(manifest.Contributes.Commands, plugin.Command{ID: fmt.Sprintf("cmd%d", i), Title: "Run"})
			}
			for i := 0; i < test.panels; i++ {
				manifest.Contributes.Panels = append(manifest.Contributes.Panels, plugin.Panel{
					ID: fmt.Sprintf("panel%d", i), Title: "Panel", Body: plugin.UINode{Type: "text", Text: "Status"},
				})
			}
			raw, err := json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			source := t.TempDir()
			for name, content := range map[string][]byte{"gonavi.plugin.json": raw, "plugin": []byte("not executed")} {
				if err = os.WriteFile(filepath.Join(source, name), content, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			result := a.PluginInspect(source)
			if test.ok && !result.Success {
				t.Fatalf("bounded contributions rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, source)) {
				t.Fatalf("count: %+v", result)
			}
		})
	}
}
