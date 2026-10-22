package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInstallKeepsUnknownDataSourceEffectDisabled(t *testing.T) {
	a := newPluginTestApp(t)
	source := writeEffectPackage(t, "unknown")
	inspected := a.PluginInspect(source)
	snapshot, ok := inspected.Data.(plugin.Inspection)
	if !inspected.Success || !ok || snapshot.Manifest.Contributes.Commands[0].Effect != "unknown" {
		t.Fatalf("inspect: %+v", inspected)
	}
	installed := a.PluginInstall(source, snapshot.Digest, true)
	if !installed.Success {
		t.Fatalf("install: %+v", installed)
	}
	list := a.PluginList()
	statuses, ok := list.Data.([]plugin.Status)
	if !list.Success || !ok {
		t.Fatalf("list: %+v", list)
	}
	var found bool
	for _, status := range statuses {
		if status.Manifest.ID != "example.source" {
			continue
		}
		found = true
		if status.DesiredEnabled || status.State == plugin.StateRunning {
			t.Fatalf("unknown-effect source started: %+v", status)
		}
	}
	if !found {
		t.Fatal("installed source missing")
	}
	write := writeEffectPackage(t, "write")
	rejected := a.PluginInstall(write, strings.Repeat("a", 64), true)
	code, _ := rejected.Data.(map[string]any)["code"].(string)
	if rejected.Success || code != "datasource_write_effect" {
		t.Fatalf("trusted install accepted a write effect: %+v", rejected)
	}
}

func writeEffectPackage(t *testing.T, effect string) string {
	t.Helper()
	source := t.TempDir()
	manifest := `{"schemaVersion":1,"apiVersion":1,"id":"example.source","name":"Source","version":"1.0.0","permissions":["data.sources"],"backend":{"default":{"executable":"plugin","runtime":"native"}},"contributes":{"commands":[{"id":"database","title":"Database","effect":"` + effect + `"}],"dataSources":[{"id":"fixture","name":"Fixture","dialect":"sqlite","command":"database","readOnly":true}]}}`
	for name, body := range map[string]string{"gonavi.plugin.json": manifest, "plugin": "not executed"} {
		if err := os.WriteFile(filepath.Join(source, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return source
}
