package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectDataSourceNameByteBounds(t *testing.T) {
	a := newPluginTestApp(t)
	for _, test := range []struct {
		name       string
		sourceName string
		ok         bool
	}{
		{name: "exact", sourceName: strings.Repeat("界", 85), ok: true},
		{name: "over", sourceName: strings.Repeat("界", 86), ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			manifest := plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.source", Name: "Source", Version: "1.0.0",
				Permissions: []string{"data.sources"},
				Backend:     &plugin.Backend{Default: &plugin.Entry{Executable: "plugin", Runtime: "native"}},
				Contributes: plugin.Contributions{
					Commands:    []plugin.Command{{ID: "database", Title: "Database", Effect: "read"}},
					DataSources: []plugin.DataSource{{ID: "fixture", Name: test.sourceName, Dialect: "sqlite", Command: "database", ReadOnly: true}},
				},
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
				t.Fatalf("exact name rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, strings.Repeat("界", 40)) || strings.Contains(result.Message, source)) {
				t.Fatalf("overlong name: %+v", result)
			}
		})
	}
}
