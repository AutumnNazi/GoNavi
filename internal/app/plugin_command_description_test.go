package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectCommandDescriptionByteBound(t *testing.T) {
	a := newPluginTestApp(t)
	for _, test := range []struct {
		name  string
		count int
		ok    bool
	}{
		{name: "exact", count: 1365, ok: true},
		{name: "over", count: 1366, ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.commands", Name: "Commands", Version: "1.0.0",
				Backend:     &plugin.Backend{Default: &plugin.Entry{Executable: "plugin", Runtime: "native"}},
				Contributes: plugin.Contributions{Commands: []plugin.Command{{ID: "run", Title: "Run", Description: strings.Repeat("文", test.count)}}},
			})
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
				t.Fatalf("bounded description rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, strings.Repeat("文", 40)) || strings.Contains(result.Message, source)) {
				t.Fatalf("overlong description: %+v", result)
			}
		})
	}
}
