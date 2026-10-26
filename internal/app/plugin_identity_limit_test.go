package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectIdentityByteBounds(t *testing.T) {
	a := newPluginTestApp(t)
	for _, test := range []struct {
		name        string
		pluginName  string
		description string
		author      string
		license     string
		leak        string
		ok          bool
	}{
		{name: "exact", ok: true, pluginName: strings.Repeat("界", 85), description: strings.Repeat("文", 5461), author: strings.Repeat("界", 170), license: strings.Repeat("界", 85)},
		{name: "name", leak: "界", pluginName: strings.Repeat("界", 86), description: "Description", author: "Author", license: "Apache-2.0"},
		{name: "description", leak: "文", pluginName: "Plugin", description: strings.Repeat("文", 5462), author: "Author", license: "Apache-2.0"},
		{name: "author", leak: "界", pluginName: "Plugin", description: "Description", author: strings.Repeat("界", 171), license: "Apache-2.0"},
		{name: "license", leak: "界", pluginName: "Plugin", description: "Description", author: "Author", license: strings.Repeat("界", 86)},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.identity", Name: test.pluginName, Version: "1.0.0",
				Description: test.description, Author: test.author, License: test.license,
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
				t.Fatalf("exact identity rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, strings.Repeat(test.leak, 40)) || strings.Contains(result.Message, source)) {
				t.Fatalf("overlong identity: %+v", result)
			}
		})
	}
}
