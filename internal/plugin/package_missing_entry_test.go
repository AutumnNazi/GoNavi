package plugin

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMissingDeclaredEntryDoesNotEchoName(t *testing.T) {
	dir := t.TempDir()
	name := strings.Repeat("文", 80)
	raw := []byte(`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[],"backend":{"default":{"executable":"` + name + `"}}}`)
	if err := os.WriteFile(filepath.Join(dir, "gonavi.plugin.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := InspectPackage(context.Background(), dir)
	if err == nil || strings.Contains(err.Error(), strings.Repeat("文", 40)) || strings.Contains(err.Error(), dir) {
		t.Fatal(err)
	}
}
