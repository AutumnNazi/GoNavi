package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPluginInspectRejectsDataSourceWriteEffect(t *testing.T) {
	a := newPluginTestApp(t)
	allowed := map[string]bool{"": true, "read": true, "unknown": true}
	for _, effect := range []string{"", "read", "unknown", "write", "WRITE", "sideeffect"} {
		source := t.TempDir()
		manifest := `{"schemaVersion":1,"apiVersion":1,"id":"example.source","name":"Source","version":"1.0.0","permissions":["data.sources"],"backend":{"default":{"executable":"plugin","runtime":"native"}},"contributes":{"commands":[{"id":"database","title":"Database","effect":"` + effect + `"}],"dataSources":[{"id":"fixture","name":"Fixture","dialect":"sqlite","command":"database","readOnly":true}]}}`
		for name, body := range map[string]string{"gonavi.plugin.json": manifest, "plugin": "not executed"} {
			if err := os.WriteFile(filepath.Join(source, name), []byte(body), 0o600); err != nil {
				t.Fatal(err)
			}
		}
		result := a.PluginInspect(source)
		if !allowed[effect] {
			code, _ := result.Data.(map[string]any)["code"].(string)
			want := "operation_failed"
			if effect == "write" {
				want = "datasource_write_effect"
			}
			if result.Success || code != want {
				t.Fatalf("desktop inspect accepted %q: %+v", effect, result)
			}
		}
		if allowed[effect] && !result.Success {
			t.Fatalf("desktop inspect rejected a read effect: %+v", result)
		}
	}
}
