package market

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestArtifactPermissionNotesStayBoundToDeclaredGrants(t *testing.T) {
	raw := noteManifest(map[string]string{"host.log": "Writes one diagnostic line"})
	manifest, err := decodeArtifactManifest(raw)
	if err != nil {
		t.Fatal(err)
	}
	if err = validateArtifactMetadata(manifest); err != nil || manifest.PermissionNotes["host.log"] == "" {
		t.Fatal(err)
	}
	decoded, err := decodeArtifactManifest(noteManifest(map[string]string{"data.export": "export"}))
	if err != nil || validateArtifactMetadata(decoded) == nil {
		t.Fatal("undeclared permission note was accepted")
	}
	decoded, err = decodeArtifactManifest(noteManifest(map[string]string{"host.log": "<b>html</b>"}))
	if err != nil || validateArtifactMetadata(decoded) == nil {
		t.Fatal("markup permission note was accepted")
	}
}

func TestArtifactPermissionCountAndNoteByteBounds(t *testing.T) {
	permissions := make([]string, 64)
	for i := range permissions {
		permissions[i] = fmt.Sprintf("perm.%d", i)
	}
	body := map[string]any{
		"schemaVersion": 1, "apiVersion": 1, "id": "example.notes", "name": "Notes", "version": "1.0.0",
		"permissions": permissions, "permissionNotes": map[string]string{"perm.0": strings.Repeat("界", 53)},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := decodeArtifactManifest(raw)
	if err != nil || validateArtifactMetadata(manifest) != nil {
		t.Fatal(err)
	}
	body["permissions"] = append(permissions, "perm.64")
	raw, err = json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	manifest, err = decodeArtifactManifest(raw)
	if err != nil || validateArtifactMetadata(manifest) == nil {
		t.Fatal("65 permissions were accepted")
	}
	body["permissions"] = permissions
	body["permissionNotes"] = map[string]string{"perm.0": strings.Repeat("界", 54)}
	raw, err = json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	manifest, err = decodeArtifactManifest(raw)
	if err != nil || validateArtifactMetadata(manifest) == nil {
		t.Fatal("permission note over 160 bytes was accepted")
	}
}

func noteManifest(notes map[string]string) []byte {
	body := map[string]any{
		"schemaVersion": 1, "apiVersion": 1, "id": "example.notes", "name": "Notes", "version": "1.0.0",
		"permissions": []string{"host.log"}, "permissionNotes": notes,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	return raw
}
