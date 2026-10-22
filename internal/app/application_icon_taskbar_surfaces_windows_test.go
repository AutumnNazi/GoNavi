//go:build windows

package app

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/image/draw"
)

func TestWindowsTaskbarLoadsCompleteCenteredSmallFramesButKeepsDesktopLargeFrames(t *testing.T) {
	root := t.TempDir()
	source := image.NewNRGBA(image.Rect(0, 0, 256, 256))
	draw.Draw(source, source.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(source, image.Rect(80, 72, 176, 192), &image.Uniform{C: color.NRGBA{R: 40, G: 70, B: 180, A: 255}}, image.Point{}, draw.Src)
	for letter := 0; letter < 6; letter++ {
		left := 96 + letter*11
		draw.Draw(source, image.Rect(left, 218, left+7, 234), &image.Uniform{C: color.NRGBA{R: 220, G: 40, B: 40, A: 255}}, image.Point{}, draw.Src)
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	iconPath, err := persistWindowsApplicationIcon(encoded.Bytes(), root)
	if err != nil {
		t.Fatal(err)
	}
	if err := activatePersistedWindowsApplicationIcon(iconPath, root); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(iconPath)
	if err != nil {
		t.Fatal(err)
	}
	originalLoad := windowsApplicationIconLoad
	originalDPI := windowsApplicationIconSystemDPI
	t.Cleanup(func() {
		windowsApplicationIconLoad = originalLoad
		windowsApplicationIconSystemDPI = originalDPI
	})
	stop := errors.New("stop after native icon selection")
	loadedPath, loadedSize := "", 0
	windowsApplicationIconSystemDPI = func() int { return 144 }
	windowsApplicationIconLoad = func(path string, pixels int) (uintptr, error) {
		loadedPath, loadedSize = path, pixels
		return 0, stop
	}
	if _, _, err := setCurrentWindowsApplicationIconMode(context.Background(), iconPath, false); !errors.Is(err, stop) {
		t.Fatalf("unexpected native load result: %v", err)
	}
	if loadedPath != iconPath || loadedSize != 48 {
		t.Fatalf("unexpected 144-DPI taskbar resource: path=%q size=%d", loadedPath, loadedSize)
	}
	after, err := os.ReadFile(iconPath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("native load rewrote the selected ICO: %v", err)
	}
	state, err := os.ReadFile(filepath.Join(root, windowsApplicationIconDirectoryName, windowsApplicationIconStateFileName))
	if err != nil || strings.TrimSpace(string(state)) != filepath.Base(iconPath) {
		t.Fatalf("native load changed the selection pointer: %q err=%v", state, err)
	}
	for _, frame := range windowsArtworkFrames(t, after) {
		blue := image.Rectangle{}
		for y := frame.Bounds().Min.Y; y < frame.Bounds().Max.Y; y++ {
			for x := frame.Bounds().Min.X; x < frame.Bounds().Max.X; x++ {
				pixel := color.NRGBAModel.Convert(frame.At(x, y)).(color.NRGBA)
				if pixel.A > 127 && int(pixel.B)-int(pixel.R) > 60 && int(pixel.B)-int(pixel.G) > 60 {
					blue = blue.Union(image.Rect(x, y, x+1, y+1))
				}
			}
		}
		if frame.Bounds().Dx() >= 24 && taskbarTestColorBounds(frame, true).Empty() {
			t.Fatalf("native frame lost its complete wordmark: %v", frame.Bounds())
		}
		if frame.Bounds().Dx() <= 48 {
			if blue.Dy()*100 < frame.Bounds().Dy()*43 || blue.Dy()*100 > frame.Bounds().Dy()*60 {
				t.Fatalf("small frame changed the logo layout instead of mild full-image scaling: subject=%v canvas=%v", blue, frame.Bounds())
			}
			continue
		}
		if blue.Dy()*100 > frame.Bounds().Dy()*55 {
			t.Fatalf("desktop large frame lost its complete composition: subject=%v canvas=%v", blue, frame.Bounds())
		}
	}
}
