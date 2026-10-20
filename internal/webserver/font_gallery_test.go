package webserver

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	aiservice "GoNavi-Wails/internal/ai/service"
	appcore "GoNavi-Wails/internal/app"
	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/fontgallery"

	"golang.org/x/image/font/gofont/gomono"
)

type fontGalleryTransport func(*http.Request) (*http.Response, error)

func (f fontGalleryTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type fontGalleryRPCProbe struct{ called bool }

func (p *fontGalleryRPCProbe) FontGalleryStatus() string {
	p.called = true
	return "desktop-font-cache"
}

func TestBrowserRPCRejectsFontGalleryBeforeReflection(t *testing.T) {
	for _, receiver := range []string{"", "App"} {
		for _, method := range []string{"FontGalleryStatus", "FontGalleryRefresh", "FontGalleryDownload", "FontGalleryPreview", "FontGalleryCancel", "FontGalleryResolve", "FontGalleryRemove"} {
			t.Run(receiver+"/"+method, func(t *testing.T) {
				probe := &fontGalleryRPCProbe{}
				invoker := &methodInvoker{targets: map[string]reflect.Value{"app": reflect.ValueOf(probe), "app.app": reflect.ValueOf(probe)}}
				_, err := invoker.Invoke(context.Background(), invokeRequest{Namespace: "app", Receiver: receiver, Method: method})
				if err == nil || !strings.Contains(err.Error(), "unavailable in web runtime") || probe.called {
					t.Fatalf("font method must be denied before reflection: called=%v err=%v", probe.called, err)
				}
			})
		}
	}
}

func TestNativeSharedRPCAllowsFontGallery(t *testing.T) {
	probe := &fontGalleryRPCProbe{}
	invoker := &methodInvoker{targets: map[string]reflect.Value{"app.app": reflect.ValueOf(probe)}, allowDesktopMethods: true}
	result, err := invoker.Invoke(context.Background(), invokeRequest{Namespace: "app", Receiver: "App", Method: "FontGalleryStatus"})
	if err != nil || result != "desktop-font-cache" || !probe.called {
		t.Fatalf("result=%v err=%v called=%v", result, err, probe.called)
	}
}

func newFontGalleryRuntimeFixture(t *testing.T, installed bool) (*SharedRuntime, fontgallery.Entry) {
	t.Helper()
	t.Setenv("GONAVI_DATA_ROOT", t.TempDir())
	application := appcore.NewApp()
	sum := sha256.Sum256(gomono.TTF)
	hash := hex.EncodeToString(sum[:])
	asset := fontgallery.Asset{Path: "assets/" + hash + ".ttf", SHA256: hash, SizeBytes: int64(len(gomono.TTF)), MIMEType: "font/ttf"}
	entry := fontgallery.Entry{ID: "go-mono", Version: "1", Kind: "mono", Family: "Go Mono", Names: map[string]string{"en-US": "Go Mono"}, Description: "Fixture font", UseCase: "SQL editor", Font: asset, Preview: asset, Attribution: "Go Authors", SourceURL: "https://example.com/source", RightsStatus: "approved", License: fontgallery.License{ID: "bsd", Name: "BSD", URL: "https://example.com/license", Notice: "Fixture notice", Text: "Permission notice"}}
	catalog, err := json.Marshal(fontgallery.Catalog{SchemaVersion: 1, Version: "1", Entries: []fontgallery.Entry{entry}})
	if err != nil {
		t.Fatal(err)
	}
	transport := fontGalleryTransport(func(r *http.Request) (*http.Response, error) {
		payload, mimeType := gomono.TTF, "font/ttf"
		if strings.HasSuffix(r.URL.Path, "catalog.json") {
			payload, mimeType = catalog, "application/json"
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{mimeType}}, ContentLength: int64(len(payload)), Body: io.NopCloser(bytes.NewReader(payload))}, nil
	})
	service, err := fontgallery.NewService(fontgallery.Options{Root: appcore.ConfigDirForIntegration(application), Client: &http.Client{Transport: transport}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	if installed {
		if _, err := service.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
			t.Fatal(err)
		}
	}
	runtime, err := NewSharedRuntime(fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html></html>")}}, application, aiservice.NewService(), SharedRuntimeOptions{RuntimeBridgePath: "/__gonavi/native-runtime.js"})
	if err != nil {
		t.Fatal(err)
	}
	return runtime, entry
}

func TestSharedRuntimeServesFontGalleryAssetsOnlyOnDesktop(t *testing.T) {
	runtime, entry := newFontGalleryRuntimeFixture(t, true)
	assetURL := fontgallery.AssetURLPrefix + strings.TrimPrefix(entry.Font.Path, "assets/")
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		recorder := httptest.NewRecorder()
		runtime.Handler().ServeHTTP(recorder, httptest.NewRequest(method, assetURL, nil))
		if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Type") != "font/ttf" {
			t.Fatalf("%s: status=%d headers=%v", method, recorder.Code, recorder.Header())
		}
		if method == http.MethodGet && !bytes.Equal(recorder.Body.Bytes(), gomono.TTF) {
			t.Fatal("font route returned different bytes")
		}
		if method == http.MethodHead && recorder.Body.Len() != 0 {
			t.Fatal("HEAD returned bytes")
		}
	}
	browser := &Server{app: runtime.server.app, assets: runtime.server.assets}
	recorder := httptest.NewRecorder()
	browser.routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, assetURL, nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("browser exposed font asset: %d", recorder.Code)
	}
}

func TestFontGalleryContextHandlersCancelNetwork(t *testing.T) {
	for _, method := range []string{"FontGalleryRefresh", "FontGalleryDownload", "FontGalleryPreview"} {
		t.Run(method, func(t *testing.T) {
			runtime, _ := newFontGalleryRuntimeFixture(t, false)
			if !slices.Contains(appcore.RequiredIssue1098WebRPCContextMethods(), method) {
				t.Errorf("required context contract omits %s", method)
			}
			if _, ok := appcore.WebRPCContextHandlers(runtime.server.app)[method]; !ok {
				t.Errorf("handler map omits %s", method)
			}
			started := make(chan struct{})
			release := make(chan struct{})
			oldTransport := http.DefaultTransport
			http.DefaultTransport = fontGalleryTransport(func(r *http.Request) (*http.Response, error) {
				close(started)
				select {
				case <-r.Context().Done():
					return nil, r.Context().Err()
				case <-release:
					return nil, errors.New("test released request without caller cancellation")
				}
			})
			defer func() { http.DefaultTransport = oldTransport }()
			request := invokeRequest{Namespace: "app", Receiver: "App", Method: method}
			if method != "FontGalleryRefresh" {
				request.Args = []json.RawMessage{json.RawMessage(`"go-mono"`), json.RawMessage(`"1"`), json.RawMessage(`"cancel-probe"`)}
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan connection.QueryResult, 1)
			go func() {
				result, err := runtime.server.invoker.Invoke(ctx, request)
				if err != nil {
					done <- connection.QueryResult{Message: err.Error()}
					return
				}
				value, ok := result.(connection.QueryResult)
				if !ok {
					done <- connection.QueryResult{Message: "unexpected result type"}
					return
				}
				done <- value
			}()
			select {
			case <-started:
			case <-time.After(2 * time.Second):
				cancel()
				close(release)
				<-done
				t.Fatal("network did not start")
			}
			cancel()
			var result connection.QueryResult
			select {
			case result = <-done:
			case <-time.After(time.Second):
				close(release)
				<-done
				t.Fatal("caller cancellation did not reach font network request")
			}
			close(release)
			data, ok := result.Data.(map[string]any)
			if result.Success || !ok || data["code"] != "canceled" {
				t.Fatalf("canceled result: %+v", result)
			}
		})
	}
}
