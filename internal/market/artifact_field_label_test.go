package market

import (
	"context"
	"strings"
	"testing"
)

func TestUnknownManifestFieldNamesShortSafeKey(t *testing.T) {
	manifest := strings.Replace(artifactTestManifest, "{", `{"bogus":1,`, 1)
	filename := artifactTestWrite(t, ".zip", artifactTestZIP(t, artifactTestEntries(manifest)))
	_, err := ValidatePackage(context.Background(), filename)
	if err == nil || err.Error() != `unknown manifest field "bogus"` {
		t.Fatal(err)
	}
}
