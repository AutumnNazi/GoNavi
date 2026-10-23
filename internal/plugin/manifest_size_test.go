package plugin

import (
	"strings"
	"testing"
)

func TestParseManifestRejectsOversizedMultibyteBody(t *testing.T) {
	small := []byte(`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[]}`)
	if _, err := ParseManifest(small); err != nil {
		t.Fatal(err)
	}
	raw := append([]byte(`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[],"description":"`), []byte(strings.Repeat("文", 400000))...)
	raw = append(raw, []byte(`"}`)...)
	if len(raw) <= maxManifestBytes {
		t.Fatal(len(raw))
	}
	_, err := ParseManifest(raw)
	if err == nil || !strings.Contains(err.Error(), "exceeds size limit") || strings.Contains(err.Error(), "文") {
		t.Fatal(err)
	}
}
