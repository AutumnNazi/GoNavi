package app

import (
	"image"
	"image/color"
	"testing"

	"golang.org/x/image/draw"
)

func TestWindowsTaskbarKeepsNearEdgePixelFootprint(t *testing.T) {
	source := taskbarFootprintFixture()
	for y := 60; y < 68; y++ {
		source.SetNRGBA(7, y, color.NRGBA{R: 210, G: 30, B: 30, A: 255})
	}
	extra := windowsTaskbarSafeCenteredExtra(source, windowsTaskbarForegroundMask(source))
	// The complete source pixel [7,8), not just its centre, must fit. At
	// extra=8 its left edge maps to -0.125 and is visibly truncated.
	if 7*(128+2*extra)-extra*128 < 0 {
		t.Fatalf("pixel centre fitted but the near-edge stroke was cropped: extra=%d", extra)
	}
}

func TestWindowsTaskbarKeepsFilterFootprintAwayFromAlphaHole(t *testing.T) {
	source := taskbarFootprintFixture()
	source.SetNRGBA(20, 64, color.NRGBA{R: 210, G: 30, B: 30, A: 255})
	source.SetNRGBA(12, 64, color.NRGBA{})
	extra := windowsTaskbarSafeCenteredExtra(source, windowsTaskbarForegroundMask(source))
	if extra >= 8 {
		t.Fatalf("kernel footprint crosses an alpha hole despite a safe centre: extra=%d", extra)
	}
}

func taskbarFootprintFixture() *image.NRGBA {
	source := image.NewNRGBA(image.Rect(0, 0, 128, 128))
	draw.Draw(source, source.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(source, image.Rect(40, 30, 88, 80), &image.Uniform{C: color.NRGBA{R: 35, G: 45, B: 150, A: 255}}, image.Point{}, draw.Src)
	return source
}
