package market

import (
	"strings"
	"testing"
)

func TestArtifactCommandDescriptionByteBound(t *testing.T) {
	for _, test := range []struct {
		name  string
		count int
		ok    bool
	}{
		{name: "exact", count: 1365, ok: true},
		{name: "over", count: 1366, ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			decoded, err := decodeArtifactManifest([]byte(artifactTestChange(t, func(fields map[string]any) {
				fields["contributes"] = map[string]any{"commands": []any{map[string]any{"id": "run", "title": "Run", "description": strings.Repeat("文", test.count)}}}
			})))
			if err != nil {
				t.Fatal(err)
			}
			err = validateArtifactContributions(decoded)
			if test.ok && err != nil {
				t.Fatal(err)
			}
			if !test.ok && err == nil {
				t.Fatal("command description over 4096 bytes was accepted")
			}
		})
	}
}
