package backgroundgallery

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func fixtureEntry() Entry {
	hash := strings.Repeat("a", 64)
	asset := Asset{Path: "assets/" + hash + ".png", SHA256: hash, SizeBytes: 100, Width: 2, Height: 2, MIMEType: "image/png"}
	return Entry{ID: "whale-maid-a", Version: "1", Names: map[string]string{"en": "Synthetic test"}, Fit: "contain", Image: asset, Thumbnail: asset, Attribution: "Test author", SourceURL: "https://example.com/source", RightsStatus: "approved", License: License{ID: "test", Name: "Test license", URL: "https://example.com/license", Notice: "Synthetic fixture", Text: "Test permission", NonCommercial: true}}
}

func TestRefreshPersistsAndFallsBack(t *testing.T) {
	catalog := Catalog{SchemaVersion: 1, Version: "1", Entries: []Entry{fixtureEntry()}}
	payload, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/gallery/catalog.json" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		if _, err := w.Write(payload); err != nil {
			t.Error(err)
		}
	}))
	root := t.TempDir()
	s, err := NewService(Options{Root: root, BaseURL: server.URL + "/gallery/", Client: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	state, err := s.Refresh(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if state.Catalog == nil || state.Catalog.Entries[0].ID != "whale-maid-a" || state.Stale {
		t.Fatalf("bad state: %+v", state)
	}
	server.Close()
	state, err = s.Refresh(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !state.Stale || state.WarningCode != "download_failed" {
		t.Fatalf("missing fallback: %+v", state)
	}
	restarted, err := NewService(Options{Root: root, Client: &http.Client{Transport: rejectTransport{t}}})
	if err != nil {
		t.Fatal(err)
	}
	state, err = restarted.Status()
	if err != nil || state.Catalog == nil {
		t.Fatalf("not persisted: %+v %v", state, err)
	}
}
