package backgroundgallery

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStorageFailureDoesNotExposeHalfInstall(t *testing.T) {
	payload, entry := syntheticPNG(t)
	s, _, root := galleryFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		if _, err := w.Write(payload); err != nil {
			t.Error(err)
		}
	})
	// Force metadata commit to fail after bytes have been downloaded and verified.
	metadata := filepath.Join(root, "background-gallery", "v1", "installed.json")
	_, err := s.Download(context.Background(), entry.ID, entry.Version, func(p Progress) {
		if p.Phase == "installing" {
			if err := os.Mkdir(metadata, 0700); err != nil {
				t.Error(err)
			}
		}
	})
	if ErrorCode(err) != "storage_failed" {
		t.Fatalf("wrong storage failure: %v", err)
	}
	assertNoTemps(t, root)
	if err := os.Remove(metadata); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Resolve(entry.ID, entry.Version); ErrorCode(err) != "unavailable" {
		t.Fatalf("half install resolved: %v", err)
	}
	recorder := httptest.NewRecorder()
	s.ServeHTTP(recorder, httptest.NewRequest("GET", installation(entry).URL, nil))
	if recorder.Code != 404 {
		t.Fatal("half install served")
	}
}

func TestCancelBeforeCommitDoesNotInstall(t *testing.T) {
	payload, entry := syntheticPNG(t)
	s, _, root := galleryFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		if _, err := w.Write(payload); err != nil {
			t.Error(err)
		}
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, err := s.Download(ctx, entry.ID, entry.Version, func(p Progress) {
		if p.Phase == "installing" {
			cancel()
		}
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("not canceled: %v", err)
	}
	assertNoTemps(t, root)
	if _, err := s.Resolve(entry.ID, entry.Version); ErrorCode(err) != "unavailable" {
		t.Fatalf("canceled install resolved: %v", err)
	}
}

func TestDownloadTimeoutDoesNotInstall(t *testing.T) {
	_, entry := syntheticPNG(t)
	_, server, root := galleryFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() })
	client := server.Client()
	client.Timeout = 100 * time.Millisecond
	s, err := NewService(Options{Root: root, BaseURL: server.URL + "/", Client: client})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); ErrorCode(err) != "download_failed" {
		t.Fatalf("wrong timeout: %v", err)
	}
	assertNoTemps(t, root)
	state, err := s.Status()
	if err != nil || len(state.Installed) != 0 {
		t.Fatalf("timeout installed: %+v %v", state, err)
	}
}

func TestInstalledStateSurvivesMissingOrInvalidCatalog(t *testing.T) {
	payload, entry := syntheticPNG(t)
	s, server, root := galleryFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		if _, err := w.Write(payload); err != nil {
			t.Error(err)
		}
	})
	if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
		t.Fatal(err)
	}
	server.Close()
	path := filepath.Join(root, "background-gallery", "v1", "catalog.json")
	if err := os.WriteFile(path, []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	state, err := s.Status()
	if err != nil || len(state.Installed) != 1 || state.Catalog != nil || !state.Stale {
		t.Fatalf("catalog corruption lost install: %+v %v", state, err)
	}
	if _, err := s.Resolve(entry.ID, entry.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
		t.Fatalf("existing install attempted network: %v", err)
	}
}

func TestInvalidIdentitiesRejectedOffline(t *testing.T) {
	s, err := NewService(Options{Root: t.TempDir(), Client: &http.Client{Transport: rejectTransport{t}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"", "../escape", "UPPER", "a/b", "a\\b"} {
		if _, err := s.Download(context.Background(), id, "1", nil); ErrorCode(err) != "invalid_id" {
			t.Fatalf("invalid download id: %v", err)
		}
		if _, err := s.Resolve(id, "1"); ErrorCode(err) != "invalid_id" {
			t.Fatalf("invalid resolve id: %v", err)
		}
		if err := s.Remove(id, "1"); ErrorCode(err) != "invalid_id" {
			t.Fatalf("invalid remove id: %v", err)
		}
	}
}
