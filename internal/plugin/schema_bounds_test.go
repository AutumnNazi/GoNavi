package plugin

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSchemaObjectByteBound(t *testing.T) {
	schema := func(n int) json.RawMessage {
		return json.RawMessage(`{"k":"` + strings.Repeat("a", n) + `"}`)
	}
	manifest := basicManifest("example.schema")
	manifest.ConfigSchema = schema((64 << 10) - 8)
	if err := ValidateManifest(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.ConfigSchema = schema((64 << 10) - 7)
	if ValidateManifest(manifest) == nil {
		t.Fatal("schema over 64 KiB was accepted")
	}
	manifest.ConfigSchema = json.RawMessage(`[]`)
	if ValidateManifest(manifest) == nil {
		t.Fatal("schema array was accepted")
	}
}
