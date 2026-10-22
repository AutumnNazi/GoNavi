package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginExporterCatalogBoundsAndUnavailableMetadata(t *testing.T) {
	statuses := make([]plugin.Status, 0, 40)
	for i := 39; i >= 0; i-- {
		declarations := make([]plugin.Exporter, 0, 8)
		for j := 0; j < 8; j++ {
			declarations = append(declarations, plugin.Exporter{ID: fmt.Sprintf("format-%d", j), Name: "NDJSON", Command: "render", Extension: "ndjson", ContentType: "application/x-ndjson"})
		}
		statuses = append(statuses, plugin.Status{Manifest: plugin.Manifest{ID: fmt.Sprintf("test.export-%03d", i), Version: "1.0.0", Permissions: []string{"data.export"}, Backend: &plugin.Backend{}, Contributes: plugin.Contributions{Exporters: declarations}}, Digest: strings.Repeat("a", 64), Generation: 1, DesiredEnabled: true, State: plugin.StateRunning})
	}
	catalog := pluginExporterCatalog(statuses, true, false)
	if len(catalog.Items) != 256 || !catalog.Truncated {
		t.Fatal("catalog item cap lost")
	}
	for i := 1; i < len(catalog.Items); i++ {
		if catalog.Items[i-1].Format >= catalog.Items[i].Format {
			t.Fatal("catalog is not deterministic")
		}
	}
	for i := range statuses {
		for j := range statuses[i].Manifest.Contributes.Exporters {
			statuses[i].Manifest.Contributes.Exporters[j].Name = strings.Repeat("\x01", 256)
		}
	}
	capped := pluginExporterCatalog(statuses, true, false)
	raw, err := json.Marshal(capped)
	if err != nil || len(raw) > 256<<10 || !capped.Truncated || len(capped.Items) == 0 {
		t.Fatal("encoded catalog cap lost")
	}
	disabled := pluginExporterCatalog(statuses[:1], false, true)
	if len(disabled.Items) == 0 || disabled.Items[0].Available || disabled.Items[0].Reason != "safe_mode" {
		t.Fatal("safe mode erased declarations or granted availability")
	}
	a := &App{ctx: context.Background(), webRuntime: true, configDir: t.TempDir()}
	if result := a.PluginExporters(); result.Success {
		t.Fatal("Web received plugin exporter catalog authority")
	}
}
