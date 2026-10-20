package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/fontgallery"
)

func TestFontGalleryStatusIsLocalAndEmptyInitially(t *testing.T) {
	a := &App{ctx: context.Background(), configDir: t.TempDir()}
	result := a.FontGalleryStatus()
	if !result.Success {
		t.Fatalf("local status failed: %s", result.Message)
	}
	state, ok := result.Data.(fontgallery.State)
	if !ok || state.Catalog != nil || len(state.Installed) != 0 {
		t.Fatalf("unexpected initial state: %#v", result.Data)
	}
}

func TestFontGalleryRejectsWebBackendWithoutTouchingStorage(t *testing.T) {
	root := t.TempDir()
	a := &App{ctx: context.Background(), configDir: root, webRuntime: true}
	calls := []struct {
		name string
		call func() connection.QueryResult
	}{
		{name: "status", call: a.FontGalleryStatus},
		{name: "refresh", call: a.FontGalleryRefresh},
		{name: "download", call: func() connection.QueryResult { return a.FontGalleryDownload("go-mono", "1", "probe") }},
		{name: "preview", call: func() connection.QueryResult { return a.FontGalleryPreview("go-mono", "1", "probe") }},
		{name: "cancel", call: func() connection.QueryResult { return a.FontGalleryCancel("probe") }},
		{name: "resolve", call: func() connection.QueryResult { return a.FontGalleryResolve("go-mono", "") }},
		{name: "remove", call: func() connection.QueryResult { return a.FontGalleryRemove("go-mono", "1") }},
	}
	for _, tc := range calls {
		t.Run(tc.name, func(t *testing.T) {
			if r := tc.call(); r.Success {
				t.Fatal("Web backend must not access desktop font gallery storage")
			}
		})
	}
	recorder := httptest.NewRecorder()
	FontGalleryAssetHandler(a).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/__gonavi/font-gallery/assets/not-present.ttf", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("Web filesystem route returned %d", recorder.Code)
	}
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 0 {
		t.Fatalf("Web font gallery mutated server storage: entries=%v err=%v", entries, err)
	}
}
