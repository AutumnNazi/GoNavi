package plugin

import (
	"strings"
	"testing"
)

func TestParseManifestNestedFieldDoesNotEchoName(t *testing.T) {
	name := strings.Repeat("文", 80)
	for _, test := range []struct{ raw, message string }{
		{`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[],"contributes":{"panels":[{"id":"main","title":"Panel","body":{"type":"text","text":"ok","` + name + `":true}}]}}`, "unknown manifest field"},
		{`{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[],"contributes":{"aiProviders":[{"id":"chat","name":"Chat","command":"ask","supportsTools":false,"supportsImages":false,"models":[{"id":"m","name":"M","contextWindow":1024,"maxOutputTokens":1,"` + name + `":true}]}]}}`, "unknown or duplicate ai declaration key"},
	} {
		_, err := ParseManifest([]byte(test.raw))
		if err == nil || !strings.Contains(err.Error(), test.message) || strings.Contains(err.Error(), strings.Repeat("文", 40)) {
			t.Fatal(err)
		}
	}
}
