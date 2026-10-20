package fontgallery

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/image/font/gofont/gomono"
)

func fontFixture(t *testing.T, entries []Entry, assetHandler http.HandlerFunc) (*Service, *httptest.Server, string) {
	t.Helper()
	catalog := Catalog{SchemaVersion: 1, Version: "1", Entries: entries}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/catalog.json" {
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(catalog); err != nil {
				t.Error(err)
			}
			return
		}
		assetHandler(w, r)
	}))
	t.Cleanup(server.Close)
	root := t.TempDir()
	s, err := NewService(Options{Root: root, BaseURL: server.URL + "/", Client: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	return s, server, root
}

func TestDownloadInstallRestartServePreviewAndRemove(t *testing.T) {
	payload := gomono.TTF
	entry := fixtureEntry(payload)
	s, server, root := fontFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "font/ttf")
		if _, err := w.Write(payload); err != nil {
			t.Error(err)
		}
	})
	preview, err := s.Preview(context.Background(), entry.ID, entry.Version, nil)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Family != "GoNaviFontPreview-go-mono" {
		t.Fatalf("preview family: %s", preview.Family)
	}
	installed, err := s.Download(context.Background(), entry.ID, entry.Version, nil)
	if err != nil {
		t.Fatal(err)
	}
	if installed.Family != "GoNaviFont-go-mono" || installed.URL != AssetURLPrefix+entry.Font.SHA256+".ttf" {
		t.Fatalf("bad installed: %+v", installed)
	}
	server.Close()
	offline, err := NewService(Options{Root: root, Client: &http.Client{Transport: rejectTransport{t}}})
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := offline.Resolve(entry.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Entry.License.Text != entry.License.Text {
		t.Fatal("lost offline license")
	}
	state, err := offline.Status()
	if err != nil || len(state.Installed) != 1 {
		t.Fatalf("bad installed state: %+v %v", state, err)
	}
	recorder := httptest.NewRecorder()
	offline.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, resolved.URL, nil))
	if recorder.Code != http.StatusOK || recorder.Body.Len() != len(payload) {
		t.Fatalf("serve installed: %d %d", recorder.Code, recorder.Body.Len())
	}
	previewRecorder := httptest.NewRecorder()
	offline.ServeHTTP(previewRecorder, httptest.NewRequest(http.MethodGet, preview.URL, nil))
	if previewRecorder.Code != http.StatusOK {
		t.Fatalf("serve preview: %d", previewRecorder.Code)
	}
	if err := offline.Remove(entry.ID, entry.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := offline.Resolve(entry.ID, ""); err == nil {
		t.Fatal("removed font still resolved")
	}
}

func TestDownloadRejectsTamperedBytes(t *testing.T) {
	payload := gomono.TTF
	entry := fixtureEntry(payload)
	s, _, _ := fontFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "font/ttf")
		corrupt := append([]byte{}, payload...)
		corrupt[len(corrupt)-1] ^= 0xff
		if _, err := w.Write(corrupt); err != nil {
			t.Error(err)
		}
	})
	if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); err == nil || ErrorCode(err) != "integrity" {
		t.Fatalf("want integrity, got %v", err)
	}
}
