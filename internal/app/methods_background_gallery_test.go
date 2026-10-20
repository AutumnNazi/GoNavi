package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"GoNavi-Wails/internal/backgroundgallery"
	"GoNavi-Wails/internal/connection"
)

func TestBackgroundGalleryStatusIsLocalAndEmptyInitially(t *testing.T) {
	a := &App{ctx: context.Background(), configDir: t.TempDir()}
	result := a.BackgroundGalleryStatus()
	if !result.Success {
		t.Fatalf("local status failed: %s", result.Message)
	}
	state, ok := result.Data.(backgroundgallery.State)
	if !ok || state.Catalog != nil || len(state.Installed) != 0 {
		t.Fatalf("unexpected initial state: %#v", result.Data)
	}
}

func TestBackgroundGalleryRejectsWebBackendWithoutTouchingStorage(t *testing.T) {
	root := t.TempDir()
	a := &App{ctx: context.Background(), configDir: root, webRuntime: true}
	calls := []struct {
		name string
		call func() connection.QueryResult
	}{
		{name: "status", call: a.BackgroundGalleryStatus},
		{name: "refresh", call: a.BackgroundGalleryRefresh},
		{name: "download", call: func() connection.QueryResult { return a.BackgroundGalleryDownload("whale-maid-a", "1", "probe") }},
		{name: "cancel", call: func() connection.QueryResult { return a.BackgroundGalleryCancel("probe") }},
		{name: "resolve", call: func() connection.QueryResult { return a.BackgroundGalleryResolve("whale-maid-a", "") }},
		{name: "remove", call: func() connection.QueryResult { return a.BackgroundGalleryRemove("whale-maid-a", "1") }},
	}
	for _, tc := range calls {
		t.Run(tc.name, func(t *testing.T) {
			if r := tc.call(); r.Success {
				t.Fatal("Web backend must not access desktop gallery storage")
			}
		})
	}
	recorder := httptest.NewRecorder()
	BackgroundGalleryAssetHandler(a).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/__gonavi/background-gallery/assets/not-present.webp", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("Web filesystem route returned %d", recorder.Code)
	}
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 0 {
		t.Fatalf("Web gallery mutated server storage: entries=%v err=%v", entries, err)
	}
}
