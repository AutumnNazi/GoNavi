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

func TestPluginInspectDependencyCount(t *testing.T) {
	a := newPluginTestApp(t)
	dependencies := make([]plugin.Dependency, 64)
	for i := range dependencies {
		dependencies[i] = plugin.Dependency{ID: fmt.Sprintf("example.dep%d", i)}
	}
	for _, test := range []struct {
		name  string
		items []plugin.Dependency
		ok    bool
	}{
		{name: "exact", items: dependencies, ok: true},
		{name: "over", items: append(append([]plugin.Dependency{}, dependencies...), plugin.Dependency{ID: "example.extra"}), ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.host", Name: "Host", Version: "1.0.0",
				Requires: test.items,
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
				t.Fatalf("64 dependencies rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, source)) {
				t.Fatalf("65 dependencies: %+v", result)
			}
		})
	}
}
