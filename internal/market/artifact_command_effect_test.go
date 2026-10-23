package market

import (
	"context"
	"testing"
)

func TestArtifactCommandEffectBounds(t *testing.T) {
	for _, test := range []struct {
		effect string
		ok     bool
	}{
		{effect: "write", ok: true},
		{effect: "WRITE"},
		{effect: "sideeffect"},
	} {
		t.Run(test.effect, func(t *testing.T) {
			decoded, err := decodeArtifactManifest([]byte(artifactTestChange(t, func(fields map[string]any) {
				fields["contributes"] = map[string]any{"commands": []any{map[string]any{"id": "run", "title": "Run", "effect": test.effect}}}
			})))
			if err != nil {
				t.Fatal(err)
			}
			err = validateArtifactContributions(decoded)
			if test.ok && err != nil {
				t.Fatal(err)
			}
			if !test.ok && err == nil {
				t.Fatal("unsupported command effect was accepted")
			}
		})
	}
}

func TestArtifactDataSourceRejectsExactWriteEffect(t *testing.T) {
	manifest := artifactDataSourceManifest(t, func(fields map[string]any, _ map[string]any) {
		commands := fields["contributes"].(map[string]any)["commands"].([]any)
		commands[0].(map[string]any)["effect"] = "write"
	})
	filename, _ := artifactDataSourceArchive(t, ".zip", manifest)
	if _, err := ValidatePackage(context.Background(), filename); err == nil {
		t.Fatal("exact write effect was accepted for a data source")
	}
}
