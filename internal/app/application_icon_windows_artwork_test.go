package app

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"golang.org/x/image/draw"
)

func TestBuildWindowsApplicationIconFitsBundledDefaultArtwork(t *testing.T) {
	ico, err := buildWindowsApplicationIconICO(bundledWindowsArtworkPNG(t))
	if err != nil {
		t.Fatalf("build default Windows icon: %v", err)
	}
	// The bundled dark tile is 820x816; fit without stretching its silhouette.
	assertWindowsArtworkFootprint(t, ico, 1, 816.0/820)
}

func TestBuildWindowsApplicationIconPreservesArtworkProportions(t *testing.T) {
	for _, tt := range []struct {
		name    string
		canvas  image.Rectangle
		artwork image.Rectangle
		width   float64
		height  float64
	}{
		{name: "ribbon breathing margin", canvas: image.Rect(0, 0, 100, 100), artwork: image.Rect(10, 10, 90, 90), width: 1, height: 1},
		{name: "portrait mark", canvas: image.Rect(0, 0, 100, 100), artwork: image.Rect(20, 10, 80, 90), width: 0.75, height: 1},
		{name: "portrait touching source edge", canvas: image.Rect(0, 0, 100, 100), artwork: image.Rect(0, 10, 60, 90), width: 0.75, height: 1},
		{name: "off-centre landscape", canvas: image.Rect(0, 0, 100, 100), artwork: image.Rect(5, 15, 85, 75), width: 1, height: 0.75},
		{name: "non-zero origin", canvas: image.Rect(30, 40, 130, 140), artwork: image.Rect(40, 50, 120, 130), width: 1, height: 1},
		{name: "mascot white tile", canvas: image.Rect(0, 0, 100, 100), artwork: image.Rect(0, 0, 100, 100), width: 1, height: 1},
	} {
		t.Run(tt.name, func(t *testing.T) {
			source := image.NewNRGBA(tt.canvas)
			draw.Draw(source, tt.artwork, &image.Uniform{C: color.White}, image.Point{}, draw.Src)
			ico, err := encodeWindowsApplicationIconICO(source)
			if err != nil {
				t.Fatalf("encode Windows artwork: %v", err)
			}
			assertWindowsArtworkFootprint(t, ico, tt.width, tt.height)
		})
	}
}

func TestBuildWindowsApplicationIconKeepsEmptyArtworkTransparent(t *testing.T) {
	ico, err := encodeWindowsApplicationIconICO(image.NewNRGBA(image.Rect(0, 0, 64, 64)))
	if err != nil {
		t.Fatalf("encode empty artwork: %v", err)
	}
	for _, frame := range windowsArtworkFrames(t, ico) {
		if visible := highAlphaBounds(frame); !visible.Empty() {
			t.Fatalf("empty frame contains visible artwork: %v", visible)
		}
	}
}

func TestLoadPersistedWindowsApplicationIconFitsLegacyArtwork(t *testing.T) {
	source, err := png.Decode(bytes.NewReader(bundledWindowsArtworkPNG(t)))
	if err != nil {
		t.Fatal(err)
	}
	for _, nativeFrames := range []bool{false, true} {
		name := "PNG-only frames"
		if nativeFrames {
			name = "native DIB frames"
		}
		t.Run(name, func(t *testing.T) {
			configDir := t.TempDir()
			iconDir := filepath.Join(configDir, windowsApplicationIconDirectoryName)
			if err := os.MkdirAll(iconDir, 0o755); err != nil {
				t.Fatal(err)
			}
			legacyPath := filepath.Join(iconDir, "gonavi-brand-padded.ico")
			legacy := legacyWindowsArtworkICO(t, source, nativeFrames)
			if err := os.WriteFile(legacyPath, legacy, 0o644); err != nil {
				t.Fatal(err)
			}
			if err := activatePersistedWindowsApplicationIcon(legacyPath, configDir); err != nil {
				t.Fatal(err)
			}

			migratedPath, err := loadPersistedWindowsApplicationIcon(configDir)
			if err != nil {
				t.Fatalf("load legacy icon: %v", err)
			}
			if migratedPath == legacyPath {
				t.Fatal("padded icon kept its old Explorer cache key")
			}
			migrated, err := os.ReadFile(migratedPath)
			if err != nil {
				t.Fatal(err)
			}
			assertWindowsArtworkFootprint(t, migrated, 1, 1)
			original, err := os.ReadFile(legacyPath)
			if err != nil || !bytes.Equal(original, legacy) {
				t.Fatalf("migration modified the previous active icon: %v", err)
			}
			state, err := os.ReadFile(filepath.Join(iconDir, windowsApplicationIconStateFileName))
			if err != nil || string(state) != filepath.Base(legacyPath)+"\n" {
				t.Fatalf("migration activated the candidate before shortcut/window success: %q, %v", state, err)
			}
			if err := activatePersistedWindowsApplicationIcon(migratedPath, configDir); err != nil {
				t.Fatal(err)
			}
			second, err := loadPersistedWindowsApplicationIcon(configDir)
			if err != nil || second != migratedPath {
				t.Fatalf("migration is not idempotent: second=%q err=%v", second, err)
			}
		})
	}
}

func TestLoadPersistedWindowsApplicationIconDoesNotMigrateUnselectedArtwork(t *testing.T) {
	source, err := png.Decode(bytes.NewReader(bundledWindowsArtworkPNG(t)))
	if err != nil {
		t.Fatal(err)
	}
	legacy := legacyWindowsArtworkICO(t, source, true)
	for _, tt := range []struct {
		name    string
		pointer string
		present bool
	}{
		{name: "missing pointer"},
		{name: "explicitly cleared", present: true},
		{name: "missing target", pointer: "gonavi-brand-missing.ico\n", present: true},
		{name: "invalid filename", pointer: "../gonavi-brand-padded.ico\n", present: true},
		{name: "invalid extension", pointer: "gonavi-brand-padded.png\n", present: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			configDir := t.TempDir()
			iconDir := filepath.Join(configDir, windowsApplicationIconDirectoryName)
			if err := os.MkdirAll(iconDir, 0o755); err != nil {
				t.Fatal(err)
			}
			legacyPath := filepath.Join(iconDir, "gonavi-brand-padded.ico")
			if err := os.WriteFile(legacyPath, legacy, 0o644); err != nil {
				t.Fatal(err)
			}
			statePath := filepath.Join(iconDir, windowsApplicationIconStateFileName)
			if tt.present {
				if err := os.WriteFile(statePath, []byte(tt.pointer), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			before, err := os.ReadDir(iconDir)
			if err != nil {
				t.Fatal(err)
			}
			iconPath, err := loadPersistedWindowsApplicationIcon(configDir)
			if err != nil || iconPath != "" {
				t.Fatalf("unselected artwork was restored: path=%q err=%v", iconPath, err)
			}
			after, err := os.ReadDir(iconDir)
			if err != nil || len(after) != len(before) {
				t.Fatalf("unselected artwork created a migration candidate: before=%d after=%d err=%v", len(before), len(after), err)
			}
			original, err := os.ReadFile(legacyPath)
			if err != nil || !bytes.Equal(original, legacy) {
				t.Fatalf("unselected artwork was modified: %v", err)
			}
			if tt.present {
				state, err := os.ReadFile(statePath)
				if err != nil || string(state) != tt.pointer {
					t.Fatalf("reader changed the existing pointer: %q err=%v", state, err)
				}
			} else if _, err := os.Stat(statePath); !os.IsNotExist(err) {
				t.Fatalf("reader created a selection pointer: %v", err)
			}
		})
	}
}

func TestLoadPersistedWindowsApplicationIconMigratesOnlySelectedArtwork(t *testing.T) {
	configDir := t.TempDir()
	iconDir := filepath.Join(configDir, windowsApplicationIconDirectoryName)
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		t.Fatal(err)
	}
	selectedColor := color.NRGBA{R: 30, G: 70, B: 140, A: 255}
	selected := image.NewNRGBA(image.Rect(0, 0, 100, 100))
	draw.Draw(selected, image.Rect(10, 10, 90, 90), &image.Uniform{C: selectedColor}, image.Point{}, draw.Src)
	selectedPath := filepath.Join(iconDir, "gonavi-brand-selected-padded.ico")
	if err := os.WriteFile(selectedPath, legacyWindowsArtworkICO(t, selected, true), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := activatePersistedWindowsApplicationIcon(selectedPath, configDir); err != nil {
		t.Fatal(err)
	}
	// A different, fully sized residual icon is written after the selection.
	// Its presence must not change either which artwork is loaded or migrated.
	residual := image.NewNRGBA(image.Rect(0, 0, 16, 16))
	draw.Draw(residual, residual.Bounds(), &image.Uniform{C: color.NRGBA{R: 255, A: 255}}, image.Point{}, draw.Src)
	residualPath := filepath.Join(iconDir, "gonavi-brand-residual.ico")
	residualICO := legacyWindowsArtworkICO(t, residual, true)
	if err := os.WriteFile(residualPath, residualICO, 0o644); err != nil {
		t.Fatal(err)
	}
	migratedPath, err := loadPersistedWindowsApplicationIcon(configDir)
	if err != nil {
		t.Fatalf("load selected legacy artwork: %v", err)
	}
	if migratedPath == selectedPath || migratedPath == residualPath || migratedPath == "" {
		t.Fatalf("selected artwork was not migrated independently: %q", migratedPath)
	}
	migrated, err := os.ReadFile(migratedPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, frame := range windowsArtworkFrames(t, migrated) {
		// The rectangular fixture gains a faint interpolation fringe in the
		// legacy ICO. Keep it intact while requiring a full-size visible mark.
		visible := highAlphaBounds(frame)
		bounds := frame.Bounds()
		if visible.Dx()*100 < bounds.Dx()*95 || visible.Dy()*100 < bounds.Dy()*95 {
			t.Fatalf("selected artwork remains undersized: visible=%v canvas=%v", visible, bounds)
		}
		center := bounds.Size().Div(2)
		if got := color.NRGBAModel.Convert(frame.At(center.X, center.Y)); got != selectedColor {
			t.Fatalf("migrated artwork came from the residual icon: center=%v want=%v", got, selectedColor)
		}
	}
	unchanged, err := os.ReadFile(residualPath)
	if err != nil || !bytes.Equal(unchanged, residualICO) {
		t.Fatalf("migration modified the unselected residual icon: %v", err)
	}
}

func TestNormalizeWindowsApplicationIconArtwork(t *testing.T) {
	for _, tt := range []struct {
		name    string
		canvas  image.Rectangle
		artwork image.Rectangle
		crop    image.Rectangle
	}{
		{name: "padded ribbon", canvas: image.Rect(0, 0, 100, 100), artwork: image.Rect(10, 10, 90, 90), crop: image.Rect(10, 10, 90, 90)},
		{name: "full mascot tile", canvas: image.Rect(0, 0, 100, 100), artwork: image.Rect(0, 0, 100, 100), crop: image.Rect(0, 0, 100, 100)},
		{name: "near-full artwork", canvas: image.Rect(0, 0, 100, 100), artwork: image.Rect(3, 3, 97, 97), crop: image.Rect(0, 0, 100, 100)},
		{name: "empty source", canvas: image.Rect(0, 0, 100, 100), crop: image.Rect(0, 0, 100, 100)},
		{name: "non-square source", canvas: image.Rect(0, 0, 100, 120), artwork: image.Rect(10, 10, 90, 90), crop: image.Rect(0, 0, 100, 120)},
		{name: "crop outside source", canvas: image.Rect(0, 0, 100, 100), artwork: image.Rect(0, 10, 60, 90), crop: image.Rect(-10, 10, 70, 90)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			source := image.NewNRGBA(tt.canvas)
			draw.Draw(source, tt.artwork, &image.Uniform{C: color.White}, image.Point{}, draw.Src)
			if crop := windowsApplicationIconArtworkBounds(source); crop != tt.crop {
				t.Fatalf("artwork crop = %v, want %v", crop, tt.crop)
			}
			normalized, changed := normalizeWindowsApplicationIconArtwork(source)
			if changed != (tt.crop != tt.canvas) {
				t.Fatalf("artwork changed = %v, crop=%v canvas=%v", changed, tt.crop, tt.canvas)
			}
			second, changedAgain := normalizeWindowsApplicationIconArtwork(normalized)
			if changedAgain || second != normalized {
				t.Fatal("already normalized artwork was resampled")
			}
		})
	}
}

func TestNormalizeWindowsApplicationIconArtworkKeepsAntialiasedEdges(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 100, 100))
	draw.Draw(source, image.Rect(11, 11, 89, 89), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	fringe := color.NRGBA{R: 100, G: 150, B: 200, A: 1}
	source.SetNRGBA(10, 10, fringe)
	if crop := windowsApplicationIconArtworkBounds(source); crop != image.Rect(10, 10, 89, 89) {
		t.Fatalf("artwork crop clipped an antialiased pixel: %v", crop)
	}
	normalized, _ := normalizeWindowsApplicationIconArtwork(source)
	if got := color.NRGBAModel.Convert(normalized.At(0, 0)); got != fringe {
		t.Fatalf("antialiased edge changed: got=%v want=%v", got, fringe)
	}
}

func bundledWindowsArtworkPNG(t *testing.T) []byte {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve artwork fixture path")
	}
	data, err := os.ReadFile(filepath.Join(filepath.Dir(filename), "..", "..", "build", "appicon.png"))
	if err != nil {
		t.Fatalf("read bundled default artwork: %v", err)
	}
	return data
}

func windowsArtworkFrames(t *testing.T, ico []byte) []image.Image {
	t.Helper()
	entries, err := parseWindowsICOEntries(ico)
	if err != nil {
		t.Fatalf("parse artwork ICO: %v", err)
	}
	frames := make([]image.Image, 0, len(entries))
	for _, entry := range entries {
		var frame image.Image
		if windowsICOPayloadIsPNG(entry.Payload) {
			frame, err = png.Decode(bytes.NewReader(entry.Payload))
		} else {
			frame, err = decodeWindowsICOBitmapFrame(entry.Payload)
		}
		if err != nil {
			t.Fatalf("decode artwork frame: %v", err)
		}
		frames = append(frames, frame)
	}
	return frames
}

func assertWindowsArtworkFootprint(t *testing.T, ico []byte, widthFraction, heightFraction float64) {
	t.Helper()
	distance := func(a, b int) int { return max(a-b, b-a) }
	for _, frame := range windowsArtworkFrames(t, ico) {
		bounds := frame.Bounds()
		visible := highAlphaBounds(frame)
		wantWidth := int(float64(bounds.Dx())*widthFraction + 0.5)
		wantHeight := int(float64(bounds.Dy())*heightFraction + 0.5)
		// The original antialiased boundary may cost at most one pixel per edge.
		if distance(visible.Dx(), wantWidth) > 2 || distance(visible.Dy(), wantHeight) > 2 {
			t.Errorf("%dx%d frame artwork = %v, want approximately %dx%d", bounds.Dx(), bounds.Dy(), visible, wantWidth, wantHeight)
		}
		if distance(visible.Min.X+visible.Max.X, bounds.Min.X+bounds.Max.X) > 2 ||
			distance(visible.Min.Y+visible.Max.Y, bounds.Min.Y+bounds.Max.Y) > 2 {
			t.Errorf("%dx%d frame artwork is not centred: %v", bounds.Dx(), bounds.Dy(), visible)
		}
	}
}

// This deliberately bypasses the production source normalization, reproducing
// both historic ICO formats while keeping the original padded artwork intact.
func legacyWindowsArtworkICO(t *testing.T, source image.Image, nativeFrames bool) []byte {
	t.Helper()
	var ico bytes.Buffer
	ico.Write([]byte{0, 0, 1, 0, byte(len(windowsApplicationIconSizes)), 0})
	frames := make([][]byte, 0, len(windowsApplicationIconSizes))
	offset := 6 + 16*len(windowsApplicationIconSizes)
	for _, size := range windowsApplicationIconSizes {
		target := image.NewNRGBA(image.Rect(0, 0, size, size))
		draw.CatmullRom.Scale(target, target.Bounds(), source, source.Bounds(), draw.Over, nil)
		var payload []byte
		if nativeFrames && size != windowsApplicationIconPNGSize {
			payload = encodeWindowsICOBitmapFrame(target)
		} else {
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, target); err != nil {
				t.Fatal(err)
			}
			payload = encoded.Bytes()
		}
		entry := make([]byte, 16)
		entry[0], entry[1] = byte(size), byte(size)
		binary.LittleEndian.PutUint16(entry[4:6], 1)
		binary.LittleEndian.PutUint16(entry[6:8], 32)
		binary.LittleEndian.PutUint32(entry[8:12], uint32(len(payload)))
		binary.LittleEndian.PutUint32(entry[12:16], uint32(offset))
		ico.Write(entry)
		frames = append(frames, payload)
		offset += len(payload)
	}
	for _, frame := range frames {
		ico.Write(frame)
	}
	return ico.Bytes()
}
