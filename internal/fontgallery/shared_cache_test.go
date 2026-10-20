package fontgallery

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/image/font/gofont/gomono"
)

func TestSharedAssetOfflineRoleRegistration(t *testing.T) {
	for _, first := range []string{"install", "preview"} {
		t.Run(first, func(t *testing.T) {
			entry := fixtureEntry(gomono.TTF)
			s, server, root := fontFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "font/ttf")
				if _, err := w.Write(gomono.TTF); err != nil {
					t.Error(err)
				}
			})
			if first == "install" {
				if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := s.Preview(context.Background(), entry.ID, entry.Version, nil); err != nil {
					t.Fatal(err)
				}
			}
			server.Close()
			offline, err := NewService(Options{Root: root, Client: &http.Client{Transport: rejectTransport{t}}})
			if err != nil {
				t.Fatal(err)
			}
			if first == "install" {
				if _, err := offline.Preview(context.Background(), entry.ID, entry.Version, nil); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := offline.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
					t.Fatal(err)
				}
			}
			installed, err := offline.installedEntries()
			if err != nil || len(installed) != 1 {
				t.Fatalf("installed metadata: %v %v", installed, err)
			}
			previews, err := offline.previewEntries()
			if err != nil || len(previews) != 1 {
				t.Fatalf("preview metadata: %v %v", previews, err)
			}
			if err := offline.Remove(entry.ID, entry.Version); err != nil {
				t.Fatal(err)
			}
			assertPreviewServed(t, offline, entry)
		})
	}
}

func TestSharedAssetPreviewSurvivesUninstall(t *testing.T) {
	entry := fixtureEntry(gomono.TTF)
	s, _, _ := fontFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "font/ttf")
		if _, err := w.Write(gomono.TTF); err != nil {
			t.Error(err)
		}
	})
	if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Preview(context.Background(), entry.ID, entry.Version, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.Remove(entry.ID, entry.Version); err != nil {
		t.Fatal(err)
	}
	assertPreviewServed(t, s, entry)
}

func assertPreviewServed(t *testing.T, s *Service, entry Entry) {
	t.Helper()
	recorder := httptest.NewRecorder()
	s.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, assetURL(entry.Preview), nil))
	if recorder.Code != http.StatusOK || recorder.Body.Len() != len(gomono.TTF) {
		t.Fatalf("preview after uninstall: status=%d bytes=%d", recorder.Code, recorder.Body.Len())
	}
	if _, err := s.Resolve(entry.ID, entry.Version); err == nil {
		t.Fatal("uninstalled font still resolves")
	}
}
