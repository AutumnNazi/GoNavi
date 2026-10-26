package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPluginInspectHidesNestedUnknownField(t *testing.T) {
	a := newPluginTestApp(t)
	name := strings.Repeat("文", 80)
	source := t.TempDir()
	raw := []byte(`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[],"contributes":{"panels":[{"id":"main","title":"Panel","body":{"type":"text","text":"ok","` + name + `":true}}]}}`)
	if err := os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	result := a.PluginInspect(source)
	if result.Success || strings.Contains(result.Message, strings.Repeat("文", 40)) || strings.Contains(result.Message, source) {
		t.Fatalf("%+v", result)
	}
}
