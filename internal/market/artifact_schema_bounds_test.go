package market

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestArtifactSchemaObjectByteBound(t *testing.T) {
	schema := func(n int) json.RawMessage {
		return json.RawMessage(`{"k":"` + strings.Repeat("a", n) + `"}`)
	}
	if err := validateArtifactSchema(schema((64 << 10) - 8)); err != nil {
		t.Fatal(err)
	}
	if validateArtifactSchema(schema((64<<10)-7)) == nil {
		t.Fatal("schema over 64 KiB was accepted")
	}
	if validateArtifactSchema(json.RawMessage(`[]`)) == nil {
		t.Fatal("schema array was accepted")
	}
}
