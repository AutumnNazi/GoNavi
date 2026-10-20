package backgroundgallery

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"hash/crc32"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDownloadRejectsInvalidImages(t *testing.T) {
	for _, kind := range []string{"hash", "short", "oversize", "dimensions", "html", "animated png", "wrong mime", "redirect"} {
		t.Run(kind, func(t *testing.T) {
			payload, entry := syntheticPNG(t)
			mimeType := "image/png"
			status := 200
			switch kind {
			case "hash":
				payload = append([]byte(nil), payload...)
				payload[len(payload)-1] ^= 1
			case "short":
				payload = payload[:len(payload)-1]
			case "oversize":
				payload = append(payload, 0)
			case "dimensions":
				entry.Image.Width++
			case "html":
				payload = []byte("<html>not an image</html>")
				entry.Image = assetFor(payload, entry.Image)
			case "animated png":
				chunk := make([]byte, 20)
				binary.BigEndian.PutUint32(chunk, 8)
				copy(chunk[4:8], "acTL")
				binary.BigEndian.PutUint32(chunk[8:12], 1)
				binary.BigEndian.PutUint32(chunk[16:20], crc32.ChecksumIEEE(chunk[4:16]))
				payload = append(append(append([]byte(nil), payload[:33]...), chunk...), payload[33:]...)
				entry.Image = assetFor(payload, entry.Image)
			case "wrong mime":
				mimeType = "text/html"
			case "redirect":
				status = 302
			}
			s, _, root := galleryFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", mimeType)
				w.Header().Set("Location", "https://example.invalid/")
				w.WriteHeader(status)
				if _, err := w.Write(payload); err != nil {
					t.Error(err)
				}
			})
			_, err := s.Download(context.Background(), entry.ID, entry.Version, nil)
			expected := "integrity"
			if kind == "redirect" {
				expected = "download_failed"
			}
			if ErrorCode(err) != expected {
				t.Fatalf("invalid image accepted: %v", err)
			}
			state, err := s.Status()
			if err != nil || len(state.Installed) != 0 {
				t.Fatalf("partial installation: %+v %v", state, err)
			}
			assertNoTemps(t, root)
		})
	}
}
func assetFor(payload []byte, asset Asset) Asset {
	sum := sha256.Sum256(payload)
	asset.SHA256 = hex.EncodeToString(sum[:])
	asset.Path = "assets/" + asset.SHA256 + ".png"
	asset.SizeBytes = int64(len(payload))
	return asset
}
func assertNoTemps(t *testing.T, root string) {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(root, "background-gallery", "v1", "assets", ".gallery-*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) > 0 {
		t.Fatalf("leaked temp files: %v", paths)
	}
}
func TestCorruptOrSymlinkAssetIsUnavailableOffline(t *testing.T) {
	for _, kind := range []string{"corrupt", "symlink", "directory", "missing"} {
		t.Run(kind, func(t *testing.T) {
			payload, entry := syntheticPNG(t)
			s, server, root := galleryFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "image/png")
				if _, err := w.Write(payload); err != nil {
					t.Error(err)
				}
			})
			installed, err := s.Download(context.Background(), entry.ID, entry.Version, nil)
			if err != nil {
				t.Fatal(err)
			}
			server.Close()
			path := filepath.Join(root, "background-gallery", "v1", filepath.FromSlash(entry.Image.Path))
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "corrupt":
				if err := os.WriteFile(path, []byte("corrupt"), 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				outside := filepath.Join(t.TempDir(), "outside.png")
				if err := os.WriteFile(outside, payload, 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(outside, path); err != nil {
					t.Fatal(err)
				}
			case "directory":
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := s.Resolve(entry.ID, entry.Version); ErrorCode(err) != "integrity" {
				t.Fatalf("unsafe image resolved: %v", err)
			}
			state, err := s.Status()
			if err != nil || len(state.Installed) != 0 {
				t.Fatalf("unsafe image in status: %+v %v", state, err)
			}
			recorder := httptest.NewRecorder()
			s.ServeHTTP(recorder, httptest.NewRequest("GET", installed.URL, nil))
			if recorder.Code != 404 {
				t.Fatalf("unsafe image served: %d", recorder.Code)
			}
		})
	}
}
func TestRemovePreservesSharedAsset(t *testing.T) {
	payload, first := syntheticPNG(t)
	second := first
	second.ID = "whale-maid-b"
	s, _, _ := galleryFixture(t, []Entry{first, second}, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		if _, err := w.Write(payload); err != nil {
			t.Error(err)
		}
	})
	for _, entry := range []Entry{first, second} {
		if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Remove(first.ID, first.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Resolve(second.ID, second.Version); err != nil {
		t.Fatalf("shared image deleted: %v", err)
	}
}
func TestLocalRoutesRejectTraversalAndMethods(t *testing.T) {
	payload, entry := syntheticPNG(t)
	s, _, _ := galleryFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		if _, err := w.Write(payload); err != nil {
			t.Error(err)
		}
	})
	installed, err := s.Download(context.Background(), entry.ID, entry.Version, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{AssetURLPrefix + "../installed.json", AssetURLPrefix + "%2e%2e/installed.json", installed.URL + "?x=1", AssetURLPrefix + strings.Repeat("a", 64) + ".svg", "/installed.json"} {
		recorder := httptest.NewRecorder()
		s.ServeHTTP(recorder, httptest.NewRequest("GET", path, nil))
		if recorder.Code != 404 {
			t.Fatalf("unsafe route %q: %d", path, recorder.Code)
		}
	}
	for _, method := range []string{"POST", "PUT", "DELETE"} {
		recorder := httptest.NewRecorder()
		s.ServeHTTP(recorder, httptest.NewRequest(method, installed.URL, nil))
		if recorder.Code != 405 {
			t.Fatalf("method allowed: %s", method)
		}
	}
	recorder := httptest.NewRecorder()
	s.ServeHTTP(recorder, httptest.NewRequest("HEAD", installed.URL, nil))
	if recorder.Code != 200 || recorder.Body.Len() != 0 {
		t.Fatal("invalid HEAD")
	}
}

func TestRejectsSymlinkStorageRoot(t *testing.T) {
	root := t.TempDir()
	s, err := NewService(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	moved := root + "-moved"
	if err := os.Rename(root, moved); err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(moved)
	if err := os.Symlink(moved, root); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Status(); ErrorCode(err) != "storage_failed" {
		t.Fatalf("replaced root accepted: %v", err)
	}
}
