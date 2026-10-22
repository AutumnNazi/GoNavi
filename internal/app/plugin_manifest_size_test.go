package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPluginInspectRejectsOversizedManifest(t *testing.T) {
	a := newPluginTestApp(t)
	raw := append([]byte(`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[],"description":"`), []byte(strings.Repeat("文", 400000))...)
	raw = append(raw, []byte(`"}`)...)
	source := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	result := a.PluginInspect(source)
	if result.Success || strings.Contains(result.Message, strings.Repeat("文", 40)) || strings.Contains(result.Message, source) {
		t.Fatalf("oversized manifest: %+v", result)
	}
}
