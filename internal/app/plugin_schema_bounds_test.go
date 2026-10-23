package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectSchemaBounds(t *testing.T) {
	a := newPluginTestApp(t)
	schema := func(n int) json.RawMessage {
		return json.RawMessage(`{"k":"` + strings.Repeat("a", n) + `"}`)
	}
	for _, test := range []struct {
		name   string
		schema json.RawMessage
		ok     bool
	}{
		{name: "exact", ok: true, schema: schema((64 << 10) - 8)},
		{name: "over", schema: schema((64 << 10) - 7)},
		{name: "array", schema: json.RawMessage(`[]`)},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.schema", Name: "Schema", Version: "1.0.0",
				ConfigSchema: test.schema,
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
				t.Fatalf("bounded schema rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, strings.Repeat("a", 80)) || strings.Contains(result.Message, source)) {
				t.Fatalf("schema bound: %+v", result)
			}
		})
	}
}
