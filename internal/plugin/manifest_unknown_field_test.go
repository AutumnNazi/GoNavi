package plugin

import (
	"strings"
	"testing"
)

func TestParseManifestUnknownFieldDoesNotEchoName(t *testing.T) {
	name := strings.Repeat("文", 80)
	raw := []byte(`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[],"` + name + `":1}`)
	_, err := ParseManifest(raw)
	if err == nil || !strings.Contains(err.Error(), "unknown manifest field") || strings.Contains(err.Error(), strings.Repeat("文", 40)) {
		t.Fatal(err)
	}
}
