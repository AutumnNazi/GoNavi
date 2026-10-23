package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectCommandEffects(t *testing.T) {
	a := newPluginTestApp(t)
	for _, test := range []struct {
		name, effect string
		source       bool
		ok           bool
	}{
		{name: "write", ok: true, effect: "write"},
		{name: "upper", effect: "WRITE"},
		{name: "alias", effect: "sideeffect"},
		{name: "data", effect: "write", source: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			manifest := plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.host", Name: "Host", Version: "1.0.0",
				Backend:     &plugin.Backend{Default: &plugin.Entry{Executable: "plugin", Runtime: "native"}},
				Contributes: plugin.Contributions{Commands: []plugin.Command{{ID: "query", Title: "Query", Effect: test.effect}}},
			}
			if test.source {
				manifest.Contributes.DataSources = []plugin.DataSource{{ID: "db", Name: "DB", Dialect: "sqlite", Command: "query", ReadOnly: true}}
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
				t.Fatalf("write command rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, source)) {
				t.Fatalf("effect: %+v", result)
			}
		})
	}
}
