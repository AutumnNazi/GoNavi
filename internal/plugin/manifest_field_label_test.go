package plugin

import (
	"strings"
	"testing"
)

func TestParseManifestNamesShortUnknownFieldOnly(t *testing.T) {
	base := `{"schemaVersion":1,"apiVersion":1,"id":"example.host","name":"Host","version":"1.0.0","permissions":[]`
	_, err := ParseManifest([]byte(base + `,"bogus":1}`))
	if err == nil || err.Error() != `unknown manifest field "bogus"` {
		t.Fatal(err)
	}
	_, err = ParseManifest([]byte(base + `,"` + strings.Repeat("文", 80) + `":1}`))
	if err == nil || err.Error() != "unknown manifest field" {
		t.Fatal(err)
	}
}
