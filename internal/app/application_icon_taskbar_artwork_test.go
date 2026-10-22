package app

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/image/draw"
)

func TestWindowsTaskbarArtworkKeepsDarkAndDegenerateSources(t *testing.T) {
	for _, tt := range []struct {
		name   string
		source image.Image
	}{
		{name: "nil"},
		{name: "empty", source: image.NewNRGBA(image.Rectangle{})},
		{name: "non-square", source: image.NewNRGBA(image.Rect(0, 0, 128, 96))},
		{name: "empty light tile", source: taskbarArtworkFixture(false, false)},
		{name: "dark tile", source: taskbarArtworkFixture(true, true)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			artwork, changed := composeWindowsTaskbarArtwork(tt.source)
			if changed || artwork != tt.source {
				t.Fatal("source without safely zoomable light-tile content was changed")
			}
		})
	}
}

func TestWindowsTaskbarArtworkPreservesCompleteLayoutAndShape(t *testing.T) {
	source := taskbarArtworkFixture(false, true)
	before := bytes.Clone(source.Pix)
	mask := windowsTaskbarForegroundMask(source)
	if !mask[60*128+60] {
		t.Fatal("background flood discarded white fur enclosed by its outline")
	}
	artwork, changed := composeWindowsTaskbarArtwork(source)
	if !changed {
		t.Fatal("safely zoomable complete image was not scaled")
	}
	if !bytes.Equal(before, source.Pix) {
		t.Fatal("taskbar scaling mutated the desktop source")
	}
	green, caption := 0, 0
	for y := 0; y < 128; y++ {
		for x := 0; x < 128; x++ {
			pixel := color.NRGBAModel.Convert(artwork.At(x, y)).(color.NRGBA)
			if pixel.A != source.NRGBAAt(x, y).A {
				t.Fatalf("outer tile alpha changed at (%d,%d)", x, y)
			}
			if pixel.A < 128 {
				continue
			}
			if int(pixel.G)-int(pixel.R) > 60 && int(pixel.G)-int(pixel.B) > 60 {
				green++
			}
			if int(pixel.R)-int(pixel.G) > 80 && int(pixel.R)-int(pixel.B) > 80 {
				caption++
			}
		}
	}
	if green < 90 || caption < 220 {
		t.Fatalf("original props or wordmark were lost: green=%d caption=%d", green, caption)
	}
}

func TestWindowsTaskbarArtworkNeverCropsEdgeContent(t *testing.T) {
	source := taskbarArtworkFixture(false, true)
	source.SetNRGBA(0, 64, color.NRGBA{R: 220, G: 20, B: 20, A: 255})
	artwork, changed := composeWindowsTaskbarArtwork(source)
	if changed || artwork != source {
		t.Fatal("edge content was sacrificed to force a larger taskbar image")
	}
}

func TestWindowsTaskbarArtworkIgnoresTranslucentTileShadow(t *testing.T) {
	source := taskbarArtworkFixture(false, true)
	plain, _ := composeWindowsTaskbarArtwork(source)
	source.SetNRGBA(126, 10, color.NRGBA{R: 20, G: 20, B: 20, A: 40})
	shadowed, _ := composeWindowsTaskbarArtwork(source)
	if taskbarTestColorBounds(plain, true) != taskbarTestColorBounds(shadowed, true) ||
		taskbarTestColorBounds(plain, false) != taskbarTestColorBounds(shadowed, false) {
		t.Fatal("faint tile shadow changed complete-image scaling or placement")
	}
}

func TestWindowsTaskbarSmallFrameMigrationIsSelectedOnlyAndIdempotent(t *testing.T) {
	var source bytes.Buffer
	if err := png.Encode(&source, taskbarArtworkFixture(false, true)); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	iconDir := filepath.Join(root, windowsApplicationIconDirectoryName)
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(iconDir, "gonavi-brand-before-optical.ico")
	header := make([]byte, 22)
	binary.LittleEndian.PutUint16(header[2:4], 1)
	binary.LittleEndian.PutUint16(header[4:6], 1)
	header[6], header[7] = 128, 128
	binary.LittleEndian.PutUint16(header[10:12], 1)
	binary.LittleEndian.PutUint16(header[12:14], 32)
	binary.LittleEndian.PutUint32(header[14:18], uint32(source.Len()))
	binary.LittleEndian.PutUint32(header[18:22], 22)
	before := append(header, source.Bytes()...)
	if err := os.WriteFile(legacy, before, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := activatePersistedWindowsApplicationIcon(legacy, root); err != nil {
		t.Fatal(err)
	}
	first, err := loadPersistedWindowsApplicationIcon(root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := loadPersistedWindowsApplicationIcon(root)
	if err != nil || first != second || first == legacy {
		t.Fatalf("selected small-frame upgrade is not stable: first=%q second=%q err=%v", first, second, err)
	}
	if !strings.HasPrefix(filepath.Base(first), windowsApplicationIconRenderPrefix) {
		t.Fatalf("new renderer reused the legacy cache key: %q", first)
	}
	after, err := os.ReadFile(legacy)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("migration modified the previous ICO: %v", err)
	}
	state := filepath.Join(iconDir, windowsApplicationIconStateFileName)
	selected, err := os.ReadFile(state)
	if err != nil || strings.TrimSpace(string(selected)) != filepath.Base(legacy) {
		t.Fatalf("candidate loading activated a new selection: %q err=%v", selected, err)
	}
	if err := activatePersistedWindowsApplicationIcon(first, root); err != nil {
		t.Fatal(err)
	}
	third, err := loadPersistedWindowsApplicationIcon(root)
	if err != nil || third != first {
		t.Fatalf("versioned small-frame ICO was migrated again: %q err=%v", third, err)
	}
}

func taskbarArtworkFixture(dark, subject bool) *image.NRGBA {
	source := image.NewNRGBA(image.Rect(0, 0, 128, 128))
	background := color.NRGBA{R: 255, G: 255, B: 255, A: 255}
	if dark {
		background = color.NRGBA{R: 45, G: 45, B: 55, A: 255}
	}
	for y := 0; y < 128; y++ {
		for x := 0; x < 128; x++ {
			dx := max(0, max(20-x, x-107))
			dy := max(0, max(20-y, y-107))
			if dx*dx+dy*dy <= 400 {
				source.SetNRGBA(x, y, background)
			}
		}
	}
	if subject {
		draw.Draw(source, image.Rect(40, 24, 88, 90), &image.Uniform{C: color.NRGBA{R: 50, G: 60, B: 70, A: 255}}, image.Point{}, draw.Src)
		draw.Draw(source, image.Rect(44, 28, 84, 86), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
		draw.Draw(source, image.Rect(94, 60, 103, 73), &image.Uniform{C: color.NRGBA{R: 25, G: 170, B: 45, A: 255}}, image.Point{}, draw.Src)
		for letter := 0; letter < 6; letter++ {
			left := 42 + letter*7
			draw.Draw(source, image.Rect(left, 112, left+5, 120), &image.Uniform{C: color.NRGBA{R: 220, G: 35, B: 35, A: 255}}, image.Point{}, draw.Src)
		}
	}
	return source
}
