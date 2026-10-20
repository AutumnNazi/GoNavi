package backgroundgallery

import (
	"os"
	"path/filepath"
	"testing"
)

// TestPublishedPayloadCompatibility is opt-in and reads only an externally
// prepared, reviewed payload; artwork never enters the repository fixtures.
func TestPublishedPayloadCompatibility(t *testing.T) {
	root := os.Getenv("GONAVI_GALLERY_COMPAT_PAYLOAD")
	if root == "" {
		t.Skip("external gallery payload not supplied")
	}
	data, err := os.ReadFile(filepath.Join(root, "catalog.json"))
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := parseCatalog(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range catalog.Entries {
		t.Run(entry.ID, func(t *testing.T) {
			for _, asset := range []Asset{entry.Image, entry.Thumbnail} {
				data, err := os.ReadFile(filepath.Join(root, asset.Path))
				if err != nil {
					t.Fatal(err)
				}
				if err := verifyImage(data, asset); err != nil {
					t.Fatalf("%s: %v", asset.Path, err)
				}
			}
		})
	}
}
