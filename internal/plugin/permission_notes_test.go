package plugin

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHelloExamplePermissionNotesParse(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "examples", "plugins", "hello", "gonavi.plugin.json"))
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := ParseManifest(raw)
	if err != nil || manifest.PermissionNotes["host.log"] == "" || manifest.PermissionNotes["ai.tools"] == "" {
		t.Fatal(err)
	}
}

func TestPermissionNotesMustMatchDeclaredGrants(t *testing.T) {
	raw := []byte(`{"schemaVersion":1,"apiVersion":1,"id":"example.notes","name":"Notes","version":"1.0.0","permissions":["host.log"],"permissionNotes":{"host.log":"Writes one diagnostic line"}}`)
	manifest, err := ParseManifest(raw)
	if err != nil || manifest.PermissionNotes["host.log"] == "" {
		t.Fatal(err)
	}
	for _, bad := range []string{
		`{"schemaVersion":1,"apiVersion":1,"id":"example.notes","name":"Notes","version":"1.0.0","permissions":["host.log"],"permissionNotes":{"data.export":"export"}}`,
		`{"schemaVersion":1,"apiVersion":1,"id":"example.notes","name":"Notes","version":"1.0.0","permissions":["host.log"],"permissionNotes":{"host.log":"<b>html</b>"}}`,
	} {
		if _, err = ParseManifest([]byte(bad)); err == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
}

func TestPermissionCountAndNoteByteBounds(t *testing.T) {
	manifest := basicManifest("example.notes")
	for i := 0; i < 64; i++ {
		manifest.Permissions = append(manifest.Permissions, fmt.Sprintf("perm.%d", i))
	}
	manifest.PermissionNotes = map[string]string{"perm.0": strings.Repeat("界", 53)}
	if err := ValidateManifest(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Permissions = append(manifest.Permissions, "perm.64")
	if ValidateManifest(manifest) == nil {
		t.Fatal("65 permissions were accepted")
	}
	manifest.Permissions = manifest.Permissions[:64]
	manifest.PermissionNotes["perm.0"] = strings.Repeat("界", 54)
	if ValidateManifest(manifest) == nil {
		t.Fatal("permission note over 160 bytes was accepted")
	}
}
