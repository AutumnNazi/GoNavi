package backgroundgallery

import (
	"strings"
	"testing"
)

func TestOriginalImageByteBudget(t *testing.T) {
	hash := strings.Repeat("a", 64)
	for _, tc := range []struct {
		name  string
		size  int64
		valid bool
	}{
		{"approved wheelchair original", 11254649, true},
		{"sixteen MiB inclusive", 16 << 20, true},
		{"over sixteen MiB", (16 << 20) + 1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			asset := Asset{Path: "assets/" + hash + ".jpg", SHA256: hash, SizeBytes: tc.size, Width: 3072, Height: 5504, MIMEType: "image/jpeg"}
			if err := validateAsset(asset, maxImageBytes); (err == nil) != tc.valid {
				t.Fatalf("size=%d valid=%v error=%v", tc.size, tc.valid, err)
			}
		})
	}
}
