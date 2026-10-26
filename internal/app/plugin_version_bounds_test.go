package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectVersionBounds(t *testing.T) {
	a := newPluginTestApp(t)
	for _, test := range []struct {
		name, version, minimum string
		ok                     bool
	}{
		{name: "exact", ok: true, version: "1.2.3-rc.1+build.007", minimum: "1.2.3"},
		{name: "short", version: "1.2", minimum: "1.0.0"},
		{name: "prefix", version: "v1.2.3", minimum: "1.0.0"},
		{name: "zero", version: "01.2.3", minimum: "1.0.0"},
		{name: "pre", version: "1.0.0", minimum: "1.2.3-01"},
		{name: "empty", version: "1.2.3-", minimum: "1.0.0"},
		{name: "build", version: "1.2.3+", minimum: "1.0.0"},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.host", Name: "Host", Version: test.version,
				Requires: []plugin.Dependency{{ID: "example.other", MinVersion: test.minimum}},
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
				t.Fatalf("valid version rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, source)) {
				t.Fatalf("version bound: %+v", result)
			}
		})
	}
}
