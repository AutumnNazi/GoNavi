package fontgallery

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestPublicationPayload is opt-in and reads only an externally staged payload.
// Normal CI never downloads real fonts or embeds them in the test binary.
func TestPublicationPayload(t *testing.T) {
	root := os.Getenv("GONAVI_FONT_PUBLICATION_DIR")
	if root == "" {
		t.Skip("set GONAVI_FONT_PUBLICATION_DIR to a prepared external payload")
	}
	payload, err := os.ReadFile(filepath.Join(root, "catalog.json"))
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := parseCatalog(payload)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Entries) == 0 {
		t.Fatal("publication must contain at least one font")
	}
	for _, entry := range catalog.Entries {
		t.Run(entry.ID, func(t *testing.T) {
			verifyPublishedEntry(t, root, entry)
		})
	}
}

func verifyPublishedEntry(t *testing.T, root string, entry Entry) {
	t.Helper()
	assets := make(map[string][]byte)
	for _, asset := range []Asset{entry.Font, entry.Preview} {
		data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(asset.Path)))
		if err != nil {
			t.Fatal(err)
		}
		if err := verifyFont(data, asset); err != nil {
			t.Fatal(err)
		}
		assets["/"+asset.Path] = data
	}
	service, server, localRoot := fontFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) {
		data, ok := assets[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "font/ttf")
		if _, err := w.Write(data); err != nil {
			t.Error(err)
		}
	})
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	preview, err := service.Preview(ctx, entry.ID, entry.Version, nil)
	if err != nil {
		t.Fatal(err)
	}
	state, err := service.Status()
	if err != nil || len(state.Installed) != 0 {
		t.Fatalf("preview counted as installed: %+v %v", state, err)
	}
	response := httptest.NewRecorder()
	service.ServeHTTP(response, httptest.NewRequest(http.MethodGet, preview.URL, nil))
	if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), assets["/"+entry.Preview.Path]) {
		t.Fatal("preview bytes mismatch")
	}
	downloaded, err := service.Download(ctx, entry.ID, entry.Version, nil)
	if err != nil {
		t.Fatal(err)
	}
	server.Close()
	offline, err := NewService(Options{Root: localRoot, Client: &http.Client{Transport: rejectTransport{t}}})
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := offline.Resolve(entry.ID, entry.Version)
	if err != nil || resolved.URL != downloaded.URL {
		t.Fatalf("offline resolve: %+v %v", resolved, err)
	}
	response = httptest.NewRecorder()
	offline.ServeHTTP(response, httptest.NewRequest(http.MethodGet, resolved.URL, nil))
	if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), assets["/"+entry.Font.Path]) {
		t.Fatal("offline font bytes mismatch")
	}
	if err := offline.Remove(entry.ID, entry.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := offline.Resolve(entry.ID, entry.Version); err == nil {
		t.Fatal("removed font still available")
	}
	t.Logf("verified %s: preview, download, offline restart, serving and removal", entry.Family)
}
