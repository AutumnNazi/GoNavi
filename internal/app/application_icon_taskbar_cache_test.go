package app

import (
	"bytes"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsTaskbarRejectedV2IsRebuiltEvenWithoutSafeZoom(t *testing.T) {
	source := taskbarArtworkFixture(false, true)
	source.SetNRGBA(0, 64, color.NRGBA{R: 210, G: 20, B: 20, A: 255})
	if _, changed := composeWindowsTaskbarArtwork(source); changed {
		t.Fatal("fixture must leave no safe zoom")
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	fresh, err := persistWindowsApplicationIcon(encoded.Bytes(), root)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(fresh)
	if err != nil {
		t.Fatal(err)
	}
	rejected := filepath.Join(filepath.Dir(fresh), "gonavi-brand-v2-rejected.ico")
	if err := os.WriteFile(rejected, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := activatePersistedWindowsApplicationIcon(rejected, root); err != nil {
		t.Fatal(err)
	}
	candidate, err := loadPersistedWindowsApplicationIcon(root)
	if err != nil {
		t.Fatal(err)
	}
	if candidate == rejected || !strings.HasPrefix(filepath.Base(candidate), windowsApplicationIconRenderPrefix) {
		t.Fatalf("rejected v2 small frames survived: candidate=%q", candidate)
	}
	selected, err := os.ReadFile(filepath.Join(filepath.Dir(fresh), windowsApplicationIconStateFileName))
	if err != nil || strings.TrimSpace(string(selected)) != filepath.Base(rejected) {
		t.Fatalf("candidate preparation committed the selection: %q err=%v", selected, err)
	}
}
