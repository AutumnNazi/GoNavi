package market

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestValidatePackageManifestMultibyteBudget(t *testing.T) {
	body := artifactTestChange(t, func(fields map[string]any) {
		fields["description"] = strings.Repeat("文", 5461)
	})
	if len(body) > maxArtifactManifestBytes {
		t.Fatal(len(body))
	}
	exact := body + strings.Repeat(" ", maxArtifactManifestBytes-len(body))
	if len(exact) != maxArtifactManifestBytes || utf8.RuneCountInString(exact) >= maxArtifactManifestBytes {
		t.Fatalf("bytes=%d runes=%d", len(exact), utf8.RuneCountInString(exact))
	}
	filename := artifactTestWrite(t, ".zip", artifactTestZIP(t, artifactTestEntries(exact)))
	if _, err := ValidatePackage(context.Background(), filename); err != nil {
		t.Fatal(err)
	}
	over := exact + " "
	if utf8.RuneCountInString(over) >= maxArtifactManifestBytes {
		t.Fatal("rune count no longer distinguishes the byte cap")
	}
	filename = artifactTestWrite(t, ".zip", artifactTestZIP(t, artifactTestEntries(over)))
	_, err := ValidatePackage(context.Background(), filename)
	if err == nil || strings.Contains(err.Error(), strings.Repeat("文", 40)) {
		t.Fatal(err)
	}
}
