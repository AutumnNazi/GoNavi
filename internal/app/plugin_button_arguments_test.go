package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectButtonArgumentBounds(t *testing.T) {
	a := newPluginTestApp(t)
	args := func(n int) json.RawMessage {
		return json.RawMessage(`{"k":"` + strings.Repeat("a", n) + `"}`)
	}
	for _, test := range []struct {
		name string
		n    int
		ok   bool
	}{
		{name: "exact", n: (64 << 10) - 8, ok: true},
		{name: "over", n: (64 << 10) - 7},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.button", Name: "Button", Version: "1.0.0",
				Backend: &plugin.Backend{Default: &plugin.Entry{Executable: "plugin", Runtime: "native"}},
				Contributes: plugin.Contributions{
					Commands: []plugin.Command{{ID: "run", Title: "Run"}},
					Panels:   []plugin.Panel{{ID: "main", Title: "Panel", Body: plugin.UINode{Type: "button", Command: "run", Arguments: args(test.n)}}},
				},
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
				t.Fatalf("bounded arguments rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, strings.Repeat("a", 80)) || strings.Contains(result.Message, source)) {
				t.Fatalf("argument bound: %+v", result)
			}
		})
	}
}
