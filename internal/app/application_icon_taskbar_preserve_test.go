package app

import (
	"image"
	"image/color"
	"testing"

	"golang.org/x/image/draw"
)

func TestWindowsTaskbarPreservesCompleteWordmark(t *testing.T) {
	source := taskbarPreservedLayoutFixture()
	before := taskbarTestColorBounds(source, true)
	artwork, _ := composeWindowsTaskbarArtwork(source)
	after := taskbarTestColorBounds(artwork, true)
	if after.Empty() || after.Dx()*after.Dy() < before.Dx()*before.Dy()*9/10 {
		t.Fatalf("complete GoNavi wordmark was deleted or cropped: before=%v after=%v", before, after)
	}
	glyphs, previousRed := 0, false
	for x := artwork.Bounds().Min.X; x < artwork.Bounds().Max.X; x++ {
		redColumn := false
		for y := artwork.Bounds().Min.Y; y < artwork.Bounds().Max.Y; y++ {
			pixel := color.NRGBAModel.Convert(artwork.At(x, y)).(color.NRGBA)
			if pixel.A >= 128 && int(pixel.R)-int(pixel.G) > 80 && int(pixel.R)-int(pixel.B) > 80 {
				redColumn = true
				break
			}
		}
		if redColumn && !previousRed {
			glyphs++
		}
		previousRed = redColumn
	}
	if glyphs != 6 {
		t.Fatalf("wordmark kept its outer bounds but lost individual letters: glyphs=%d", glyphs)
	}
}

func TestWindowsTaskbarDoesNotReanchorLogoToSubjectCenter(t *testing.T) {
	source := taskbarPreservedLayoutFixture()
	before := taskbarTestColorBounds(source, false)
	artwork, _ := composeWindowsTaskbarArtwork(source)
	after := taskbarTestColorBounds(artwork, false)
	// The logo intentionally sits below the canvas centre. Scaling around the
	// canvas may move it slightly farther down, but must never centre it anew.
	if after.Min.Y+after.Max.Y < before.Min.Y+before.Max.Y-1 {
		t.Fatalf("logo moved upwards instead of preserving its original layout: before=%v after=%v", before, after)
	}
	if after.Min.X+after.Max.X < 126 || after.Min.X+after.Max.X > 130 {
		t.Fatalf("logo no longer follows the original horizontal canvas centre: %v", after)
	}
}

func TestWindowsTaskbarKeepsOffsetsFromCanvasCenter(t *testing.T) {
	for _, tt := range []struct {
		name string
		logo image.Rectangle
	}{
		{name: "left", logo: image.Rect(20, 48, 60, 80)},
		{name: "right", logo: image.Rect(68, 48, 108, 80)},
		{name: "above", logo: image.Rect(44, 24, 84, 56)},
		{name: "below", logo: image.Rect(44, 72, 84, 104)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			source := taskbarArtworkFixture(false, false)
			draw.Draw(source, tt.logo, &image.Uniform{C: color.NRGBA{R: 35, G: 45, B: 150, A: 255}}, image.Point{}, draw.Src)
			artwork, _ := composeWindowsTaskbarArtwork(source)
			after := taskbarTestColorBounds(artwork, false)
			if after.Empty() {
				t.Fatal("whole-image scaling lost the logo")
			}
			beforeOffsets := []int{tt.logo.Min.X + tt.logo.Max.X - 128, tt.logo.Min.Y + tt.logo.Max.Y - 128}
			afterOffsets := []int{after.Min.X + after.Max.X - 128, after.Min.Y + after.Max.Y - 128}
			for axis, before := range beforeOffsets {
				if before < 0 && afterOffsets[axis] > before+1 || before > 0 && afterOffsets[axis] < before-1 {
					t.Fatalf("logo was reanchored instead of following its canvas: before=%v after=%v", beforeOffsets, afterOffsets)
				}
			}
		})
	}
}

func taskbarPreservedLayoutFixture() *image.NRGBA {
	source := taskbarArtworkFixture(false, false)
	draw.Draw(source, image.Rect(36, 52, 92, 84), &image.Uniform{C: color.NRGBA{R: 35, G: 45, B: 150, A: 255}}, image.Point{}, draw.Src)
	for letter := 0; letter < 6; letter++ {
		left := 43 + letter*7
		draw.Draw(source, image.Rect(left, 104, left+5, 114), &image.Uniform{C: color.NRGBA{R: 210, G: 35, B: 35, A: 255}}, image.Point{}, draw.Src)
	}
	return source
}

func taskbarTestColorBounds(source image.Image, red bool) image.Rectangle {
	box := image.Rectangle{}
	for y := source.Bounds().Min.Y; y < source.Bounds().Max.Y; y++ {
		for x := source.Bounds().Min.X; x < source.Bounds().Max.X; x++ {
			pixel := color.NRGBAModel.Convert(source.At(x, y)).(color.NRGBA)
			match := int(pixel.B)-int(pixel.R) > 60 && int(pixel.B)-int(pixel.G) > 60
			if red {
				match = int(pixel.R)-int(pixel.G) > 80 && int(pixel.R)-int(pixel.B) > 80
			}
			if pixel.A >= 128 && match {
				box = box.Union(image.Rect(x, y, x+1, y+1))
			}
		}
	}
	return box
}
