package fontgallery

import (
	"bytes"
	"net/http"
	"strings"
	"time"
)

var _ http.Handler = (*Service)(nil)

// ServeHTTP serves only verified installed or preview font bytes.
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !strings.HasPrefix(r.URL.Path, AssetURLPrefix) || r.URL.RawPath != "" || r.URL.RawQuery != "" {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, AssetURLPrefix)
	var asset Asset
	var payload []byte
	found := false
	err := s.snapshot(func() error {
		entries, err := s.installedEntries()
		if err != nil {
			return err
		}
		previews, err := s.previewEntries()
		if err != nil {
			return err
		}
		for _, entry := range append(append([]Entry{}, entries...), previews...) {
			if entry.Font.Path == "assets/"+name {
				asset = entry.Font
				found = true
				break
			}
			if entry.Preview.Path == "assets/"+name {
				asset = entry.Preview
				found = true
				break
			}
		}
		if found {
			payload, err = s.verifiedAsset(asset)
		}
		return err
	})
	if err != nil || !found {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", asset.MIMEType)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("ETag", "\""+asset.SHA256+"\"")
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(payload))
}
