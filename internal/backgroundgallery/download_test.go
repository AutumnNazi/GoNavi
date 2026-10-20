package backgroundgallery

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"
)

func syntheticPNG(t *testing.T) ([]byte, Entry) {
	t.Helper()
	picture := image.NewNRGBA(image.Rect(0, 0, 2, 3))
	picture.Set(0, 0, color.NRGBA{R: 125, A: 255})
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, picture); err != nil {
		t.Fatal(err)
	}
	payload := buffer.Bytes()
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])
	e := fixtureEntry()
	e.Image = Asset{Path: "assets/" + hash + ".png", SHA256: hash, SizeBytes: int64(len(payload)), Width: 2, Height: 3, MIMEType: "image/png"}
	e.Thumbnail = e.Image
	return payload, e
}
func galleryFixture(t *testing.T, entries []Entry, assetHandler http.HandlerFunc) (*Service, *httptest.Server, string) {
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
func TestDownloadInstallRestartServeAndRemove(t *testing.T) {
	payload, entry := syntheticPNG(t)
	s, server, root := galleryFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		if _, err := w.Write(payload); err != nil {
			t.Error(err)
		}
	})
	var progress []Progress
	installed, err := s.Download(context.Background(), entry.ID, entry.Version, func(p Progress) {
		progress = append(progress, p)
		if _, err := s.Status(); err != nil {
			t.Error(err)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if installed.URL != AssetURLPrefix+entry.Image.SHA256+".png" || len(progress) < 2 || progress[len(progress)-1].Phase != "complete" {
		t.Fatalf("bad installed/progress: %+v %+v", installed, progress)
	}
	for _, p := range progress {
		if p.RequestID != "" || p.Total != int64(len(payload)) {
			t.Fatalf("bad progress: %+v", p)
		}
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
	if recorder.Code != 200 || !bytes.Equal(recorder.Body.Bytes(), payload) || recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("bad local response: %d", recorder.Code)
	}
	if err := offline.Remove(entry.ID, entry.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := offline.Resolve(entry.ID, entry.Version); ErrorCode(err) != "unavailable" {
		t.Fatalf("removed image resolved: %v", err)
	}
	recorder = httptest.NewRecorder()
	offline.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, resolved.URL, nil))
	if recorder.Code != 404 {
		t.Fatalf("removed asset served: %d", recorder.Code)
	}
}
