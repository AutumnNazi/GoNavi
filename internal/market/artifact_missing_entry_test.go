package market

import (
	"context"
	"strings"
	"testing"
)

func TestMissingArtifactEntryDoesNotEchoName(t *testing.T) {
	name := strings.Repeat("文", 80)
	manifest := artifactTestChange(t, func(fields map[string]any) {
		fields["backend"] = map[string]any{"default": map[string]any{"executable": name}}
	})
	filename := artifactTestWrite(t, ".zip", artifactTestZIP(t, artifactTestEntries(manifest)))
	_, err := ValidatePackage(context.Background(), filename)
	if err == nil || strings.Contains(err.Error(), strings.Repeat("文", 40)) || strings.Contains(err.Error(), filename) {
		t.Fatal(err)
	}
}
