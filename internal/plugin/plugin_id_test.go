package plugin

import (
	"strings"
	"testing"
)

func TestPluginIDBounds(t *testing.T) {
	if err := ValidateManifest(basicManifest("example.plugin")); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"Example.plugin", "example.plugin-", "plugin", "example." + strings.Repeat("a", 121)} {
		if ValidateManifest(basicManifest(id)) == nil {
			t.Fatalf("accepted %s", id)
		}
	}
	manifest := basicManifest("example.host")
	manifest.Requires = []Dependency{{ID: "example.host"}}
	if ValidateManifest(manifest) == nil {
		t.Fatal("self dependency was accepted")
	}
	manifest.Requires = []Dependency{{ID: "example.other"}, {ID: "example.other"}}
	if ValidateManifest(manifest) == nil {
		t.Fatal("duplicate dependency was accepted")
	}
}
