package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectLocalIDBounds(t *testing.T) {
	a := newPluginTestApp(t)
	for _, test := range []struct {
		name string
		ids  []string
		ok   bool
	}{
		{name: "exact", ok: true, ids: []string{"run.now_1-A"}},
		{name: "hyphen", ids: []string{"-run"}},
		{name: "slash", ids: []string{"run/now"}},
		{name: "space", ids: []string{"run now"}},
		{name: "length", ids: []string{strings.Repeat("a", 129)}},
		{name: "duplicate", ids: []string{"run", "run"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			commands := make([]plugin.Command, len(test.ids))
			for i, id := range test.ids {
				commands[i] = plugin.Command{ID: id, Title: "Run"}
			}
			raw, err := json.Marshal(plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.host", Name: "Host", Version: "1.0.0",
				Backend:     &plugin.Backend{Default: &plugin.Entry{Executable: "plugin", Runtime: "native"}},
				Contributes: plugin.Contributions{Commands: commands},
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
				t.Fatalf("valid local id rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, strings.Repeat("a", 40)) || strings.Contains(result.Message, source)) {
				t.Fatalf("local id: %+v", result)
			}
		})
	}
}
