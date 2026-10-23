package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectIDBounds(t *testing.T) {
	a := newPluginTestApp(t)
	longID := "example." + strings.Repeat("a", 121)
	for _, test := range []struct {
		name, id string
		deps     []plugin.Dependency
		ok       bool
	}{
		{name: "exact", ok: true, id: "example.plugin"},
		{name: "case", id: "Example.plugin"},
		{name: "hyphen", id: "example.plugin-"},
		{name: "length", id: longID},
		{name: "self", id: "example.host", deps: []plugin.Dependency{{ID: "example.host"}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: test.id, Name: "Identity", Version: "1.0.0",
				Requires: test.deps,
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
				t.Fatalf("valid id rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, strings.Repeat("a", 40)) || strings.Contains(result.Message, source)) {
				t.Fatalf("id bound: %+v", result)
			}
		})
	}
}
