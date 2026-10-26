package plugin

import (
	"strings"
	"testing"
)

func TestParseManifestRejectsNestedUnknownFields(t *testing.T) {
	valid := []byte(`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[]}`)
	manifest, err := ParseManifest(valid)
	if err != nil || manifest.ID != "example.host" {
		t.Fatal(err)
	}
	name := strings.Repeat("文", 80)
	for _, raw := range []string{
		`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[],"contributes":{"panels":[{"id":"main","title":"Panel","body":{"type":"text","text":"ok","` + name + `":true}}]}}`,
		`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[],"contributes":{"aiProviders":[{"id":"chat","name":"Chat","command":"ask","supportsTools":false,"supportsImages":false,"models":[{"id":"m","name":"M","contextWindow":1024,"maxOutputTokens":1,"` + name + `":true}]}]}}`,
	} {
		_, err = ParseManifest([]byte(raw))
		if err == nil || err.Error() != "unknown manifest field" || strings.Contains(err.Error(), "文") {
			t.Fatal(err)
		}
	}
}
