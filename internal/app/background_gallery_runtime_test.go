package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"GoNavi-Wails/internal/backgroundgallery"
	"GoNavi-Wails/internal/connection"
)

func newBlockingGalleryApp(t *testing.T) (*App, <-chan struct{}, context.CancelFunc) {
	t.Helper()
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(imageBytes.Bytes())
	digest := hex.EncodeToString(sum[:])
	asset := backgroundgallery.Asset{Path: "assets/" + digest + ".png", SHA256: digest, SizeBytes: int64(imageBytes.Len()), Width: 2, Height: 2, MIMEType: "image/png"}
	entry := backgroundgallery.Entry{ID: "test-background", Version: "1", Names: map[string]string{"en-US": "Test"}, Fit: "contain", Image: asset, Thumbnail: asset, Attribution: "Test artist", SourceURL: "https://example.invalid/source", RightsStatus: "approved", License: backgroundgallery.License{ID: "CC0-1.0", Name: "Test license", URL: "https://example.invalid/license", Notice: "Synthetic test image", Text: "Synthetic test fixture only"}}
	catalog := backgroundgallery.Catalog{SchemaVersion: 1, Version: "test-1", Entries: []backgroundgallery.Entry{entry}}
	started := make(chan struct{})
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/catalog.json" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(catalog)
			return
		}
		if r.URL.Path != "/"+asset.Path {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	}))
	t.Cleanup(server.Close)
	parent, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	a := &App{ctx: parent, configDir: t.TempDir()}
	service, err := backgroundgallery.NewService(backgroundgallery.Options{Root: a.configDir, BaseURL: server.URL + "/", Client: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	a.backgroundGallery.root = a.configDir
	a.backgroundGallery.service = service
	if result := a.BackgroundGalleryRefresh(); !result.Success {
		t.Fatalf("refresh: %#v", result)
	}
	return a, started, cancel
}

func TestBackgroundGalleryDownloadCancellationLifecycle(t *testing.T) {
	for _, mode := range []string{"cancel-api", "application-context", "shared-rpc-context", "shutdown"} {
		t.Run(mode, func(t *testing.T) {
			a, started, cancelApplication := newBlockingGalleryApp(t)
			rpcContext, cancelRPC := context.WithCancel(context.Background())
			defer cancelRPC()
			result := make(chan connection.QueryResult, 1)
			go func() {
				if mode == "shared-rpc-context" {
					handler := WebRPCContextHandlers(a)["BackgroundGalleryDownload"].(func(context.Context, string, string, string) connection.QueryResult)
					result <- handler(rpcContext, "test-background", "1", "download-probe")
				} else {
					result <- a.BackgroundGalleryDownload("test-background", "1", "download-probe")
				}
			}()
			select {
			case <-started:
			case <-time.After(3 * time.Second):
				t.Fatal("download did not start")
			}
			switch mode {
			case "cancel-api":
				if r := a.BackgroundGalleryCancel("download-probe"); !r.Success {
					t.Fatal(r.Message)
				}
			case "application-context":
				cancelApplication()
			case "shared-rpc-context":
				cancelRPC()
			case "shutdown":
				if !a.shutdownBackgroundGallery() {
					t.Fatal("shutdown did not join canceled download")
				}
			}
			select {
			case r := <-result:
				if r.Success {
					t.Fatal("canceled request reported success")
				}
				payload, ok := r.Data.(map[string]any)
				if !ok || payload["code"] != "canceled" {
					t.Fatalf("cancel result: %#v", r)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("canceled download did not finish")
			}
			a.backgroundGallery.mu.Lock()
			remaining := len(a.backgroundGallery.requests)
			a.backgroundGallery.mu.Unlock()
			if remaining != 0 {
				t.Fatalf("request leaked after cancel: %d", remaining)
			}
		})
	}
}

func TestBackgroundGalleryCancelBeforeRegistrationDoesNotDownload(t *testing.T) {
	a, started, _ := newBlockingGalleryApp(t)
	if r := a.BackgroundGalleryCancel("race-probe"); !r.Success {
		t.Fatal(r.Message)
	}
	result := a.BackgroundGalleryDownload("test-background", "1", "race-probe")
	if result.Success {
		t.Fatal("pre-canceled request succeeded")
	}
	if result.Data.(map[string]any)["code"] != "canceled" {
		t.Fatalf("unexpected result: %#v", result)
	}
	select {
	case <-started:
		t.Fatal("pre-canceled request reached the network")
	default:
	}
}

func TestBackgroundGalleryDuplicateRequestDoesNotCancelExisting(t *testing.T) {
	a, started, _ := newBlockingGalleryApp(t)
	done := make(chan connection.QueryResult, 1)
	go func() { done <- a.BackgroundGalleryDownload("test-background", "1", "same-id") }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("download did not start")
	}
	duplicate := a.BackgroundGalleryDownload("test-background", "1", "same-id")
	if duplicate.Success {
		t.Fatal("duplicate request was accepted")
	}
	select {
	case <-done:
		t.Fatal("duplicate canceled the original request")
	default:
	}
	a.BackgroundGalleryCancel("same-id")
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("original request did not finish")
	}
}
