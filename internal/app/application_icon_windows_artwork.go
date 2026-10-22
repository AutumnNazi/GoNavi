package app

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"os"

	"golang.org/x/image/draw"
)

// Ribbon artwork and historic Apple-grid PNGs leave about 20% transparent
// padding. Windows uses the entire ICO cell; keep already full-size artwork
// untouched so repeated startups neither resample it nor enlarge mascot tiles.
const windowsApplicationIconArtworkMinPercent = 90

func windowsApplicationIconArtworkBounds(source image.Image) image.Rectangle {
	bounds := source.Bounds()
	if bounds.Dx() != bounds.Dy() {
		return bounds
	}
	visible := image.Rectangle{}
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			_, _, _, alpha := source.At(x, y).RGBA()
			if alpha == 0 {
				continue
			}
			visible = visible.Union(image.Rect(x, y, x+1, y+1))
		}
	}
	size := max(visible.Dx(), visible.Dy())
	if visible.Empty() || size*100 >= bounds.Dx()*windowsApplicationIconArtworkMinPercent {
		return bounds
	}
	// Use a square crop, not the tight rectangular bounds: portrait/landscape
	// marks retain their proportions and their antialiased edges. The crop may
	// extend outside the source to centre artwork that originally sat off-centre.
	left := visible.Min.X - (size-visible.Dx())/2
	top := visible.Min.Y - (size-visible.Dy())/2
	return image.Rect(left, top, left+size, top+size)
}

func normalizeWindowsApplicationIconArtwork(source image.Image) (image.Image, bool) {
	crop := windowsApplicationIconArtworkBounds(source)
	if crop == source.Bounds() {
		return source, false
	}
	normalized := image.NewNRGBA(image.Rect(0, 0, crop.Dx(), crop.Dy()))
	draw.Draw(normalized, normalized.Bounds(), source, crop.Min, draw.Src)
	return normalized, true
}

// preparePersistedWindowsApplicationIconArtwork runs before startup repairs
// shortcuts, including when the user keeps the same selected brand. Writing a
// new content-addressed candidate makes Explorer miss its old cached bitmap.
// The existing activation transaction still owns active-icon.txt; the previous
// ICO remains intact if the shortcut or window update fails.
func preparePersistedWindowsApplicationIconArtwork(iconPath, configDir string) (string, error) {
	data, err := os.ReadFile(iconPath)
	if err != nil {
		return "", fmt.Errorf("read persisted Windows icon artwork: %w", err)
	}
	entries, err := parseWindowsICOEntries(data)
	if err != nil {
		return "", fmt.Errorf("parse persisted Windows icon artwork: %w", err)
	}
	// Older externally supplied bitmap-only ICOs have no lossless PNG source.
	// Keep those supported rather than treating an unavailable crop as corruption.
	hasPNG := false
	for _, entry := range entries {
		if windowsICOPayloadIsPNG(entry.Payload) {
			hasPNG = true
			break
		}
	}
	if !hasPNG {
		return iconPath, nil
	}
	source, err := decodeWindowsICOSourceImageFromEntries(entries)
	if err != nil {
		return "", err
	}
	normalized, changed := normalizeWindowsApplicationIconArtwork(source)
	if !changed {
		return preparePersistedWindowsTaskbarArtwork(iconPath, configDir)
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, normalized); err != nil {
		return "", fmt.Errorf("encode normalized Windows icon artwork: %w", err)
	}
	return persistWindowsApplicationIcon(encoded.Bytes(), configDir)
}
