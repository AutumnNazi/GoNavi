package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectContributionNameByteBounds(t *testing.T) {
	a := newPluginTestApp(t)
	exact := strings.Repeat("界", 85)
	over := strings.Repeat("界", 86)
	for _, test := range []struct {
		name     string
		manifest plugin.Manifest
		ok       bool
	}{
		{name: "exporter exact", ok: true, manifest: exporterManifest(exact)},
		{name: "exporter over", ok: false, manifest: exporterManifest(over)},
		{name: "provider exact", ok: true, manifest: providerManifest(exact, "Model")},
		{name: "provider over", ok: false, manifest: providerManifest(over, "Model")},
		{name: "model over", ok: false, manifest: providerManifest("Chat", over)},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(test.manifest)
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

func exporterManifest(name string) plugin.Manifest {
	return plugin.Manifest{
		SchemaVersion: 1, APIVersion: 1, ID: "example.export", Name: "Export", Version: "1.0.0",
		Permissions: []string{"data.export"},
		Backend:     &plugin.Backend{Default: &plugin.Entry{Executable: "plugin", Runtime: "native"}},
		Contributes: plugin.Contributions{
			Commands:  []plugin.Command{{ID: "render", Title: "Render", Effect: "read"}},
			Exporters: []plugin.Exporter{{ID: "ndjson", Name: name, Command: "render", Extension: "ndjson", ContentType: "application/x-ndjson"}},
		},
	}
}

func providerManifest(name, model string) plugin.Manifest {
	return plugin.Manifest{
		SchemaVersion: 1, APIVersion: 1, ID: "example.ai", Name: "AI", Version: "1.0.0",
		Permissions: []string{"ai.providers"},
		Backend:     &plugin.Backend{Default: &plugin.Entry{Executable: "plugin", Runtime: "native"}},
		Contributes: plugin.Contributions{
			Commands:    []plugin.Command{{ID: "generate", Title: "Generate"}},
			AIProviders: []plugin.AIProvider{{ID: "chat", Name: name, Command: "generate", SupportsTools: true, Models: []plugin.AIModel{{ID: "model", Name: model, ContextWindow: 4096, MaxOutputTokens: 512}}}},
		},
	}
}
