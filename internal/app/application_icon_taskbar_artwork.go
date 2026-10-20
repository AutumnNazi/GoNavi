package app

import (
	"image"
	"image/color"

	"golang.org/x/image/draw"
)

const (
	windowsTaskbarMaximumZoomPercent   = 113
	windowsTaskbarArtworkMaxPixels     = 48
	windowsApplicationIconRenderPrefix = "gonavi-brand-v3-"
)

// Scale the complete raster around its original canvas centre. The wordmark,
// mascot and props share exactly one transform; none is removed or re-anchored.
// The content mask limits safe zoom only. It must never determine the centre.
func composeWindowsTaskbarArtwork(source image.Image) (image.Image, bool) {
	if source == nil || source.Bounds().Empty() || source.Bounds().Dx() != source.Bounds().Dy() {
		return source, false
	}
	if _, light := windowsTaskbarTileBackground(source); !light {
		return source, false
	}
	size := source.Bounds().Dx()
	work := image.NewNRGBA(image.Rect(0, 0, size, size))
	draw.Draw(work, work.Bounds(), source, source.Bounds().Min, draw.Src)
	content := windowsTaskbarForegroundMask(work)
	if windowsTaskbarMaskBounds(content, size, size).Empty() {
		return source, false
	}
	extra := windowsTaskbarSafeCenteredExtra(work, content)
	if extra == 0 {
		return source, false
	}
	target := image.NewNRGBA(work.Bounds())
	destination := image.Rect(-extra, -extra, size+extra, size+extra)
	draw.CatmullRom.Scale(target, destination, work, work.Bounds(), draw.Src, nil)
	// Preserve the original rounded tile outline, not a newly cropped shape.
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			pixel := target.NRGBAAt(x, y)
			pixel.A = work.NRGBAAt(x, y).A
			target.SetNRGBA(x, y, pixel)
		}
	}
	return target, true
}

func windowsTaskbarSafeCenteredExtra(source *image.NRGBA, content []bool) int {
	size := source.Bounds().Dx()
	coverage := windowsTaskbarOpaqueCoverage(source)
	for percent := windowsTaskbarMaximumZoomPercent; percent > 100; percent-- {
		extra := (size*(percent-100) + 100) / 200
		if extra == 0 {
			continue
		}
		if windowsTaskbarCenteredContentFits(size, content, extra, coverage) {
			return extra
		}
	}
	return 0
}

func windowsTaskbarCenteredContentFits(size int, content []bool, extra int, coverage []int) bool {
	scaled := size + extra*2
	stride := size + 1
	radius := int(draw.CatmullRom.Support)
	for index, visible := range content {
		if !visible {
			continue
		}
		x, y := index%size, index/size
		// Transform the whole source pixel and its filter support, not just
		// its centre. Integer numerators retain fractional boundary crossings.
		left := (x-radius)*scaled - extra*size
		top := (y-radius)*scaled - extra*size
		right := (x+1+radius)*scaled - extra*size
		bottom := (y+1+radius)*scaled - extra*size
		if left < 0 || top < 0 || right > size*size || bottom > size*size {
			return false
		}
		left, top = left/size, top/size
		right, bottom = (right+size-1)/size, (bottom+size-1)/size
		// The summed-area table checks the entire footprint, including alpha
		// holes inside it. Requiring opaque coverage is intentionally cautious.
		blocked := coverage[bottom*stride+right] - coverage[top*stride+right] -
			coverage[bottom*stride+left] + coverage[top*stride+left]
		if blocked != 0 {
			return false
		}
	}
	return true
}

func windowsTaskbarOpaqueCoverage(source *image.NRGBA) []int {
	width, height := source.Bounds().Dx(), source.Bounds().Dy()
	stride := width + 1
	coverage := make([]int, stride*(height+1))
	for y := 0; y < height; y++ {
		blocked := 0
		for x := 0; x < width; x++ {
			if source.NRGBAAt(x, y).A != 255 {
				blocked++
			}
			coverage[(y+1)*stride+x+1] = coverage[y*stride+x+1] + blocked
		}
	}
	return coverage
}

func windowsTaskbarTileBackground(source image.Image) (color.NRGBA, bool) {
	bounds := source.Bounds()
	size := bounds.Dx()
	inset := max(1, size/32)
	points := []image.Point{
		{X: bounds.Min.X + size/2, Y: bounds.Min.Y + inset},
		{X: bounds.Min.X + size/2, Y: bounds.Max.Y - 1 - inset},
		{X: bounds.Min.X + inset, Y: bounds.Min.Y + size/2},
		{X: bounds.Max.X - 1 - inset, Y: bounds.Min.Y + size/2},
	}
	red, green, blue, count := 0, 0, 0, 0
	for _, point := range points {
		pixel := color.NRGBAModel.Convert(source.At(point.X, point.Y)).(color.NRGBA)
		if pixel.A < 220 || !windowsTaskbarNeutralLight(pixel) {
			continue
		}
		red += int(pixel.R)
		green += int(pixel.G)
		blue += int(pixel.B)
		count++
	}
	if count < 3 {
		return color.NRGBA{}, false
	}
	return color.NRGBA{R: uint8(red / count), G: uint8(green / count), B: uint8(blue / count), A: 255}, true
}

func windowsTaskbarNeutralLight(pixel color.NRGBA) bool {
	low := min(pixel.R, pixel.G, pixel.B)
	high := max(pixel.R, pixel.G, pixel.B)
	return low >= 190 && int(high)-int(low) <= 45
}

// Include every non-background region, including wordmarks and disconnected
// props. Enclosed white fur remains content; faint tile shadows do not set zoom.
func windowsTaskbarForegroundMask(source *image.NRGBA) []bool {
	width, height := source.Bounds().Dx(), source.Bounds().Dy()
	background := make([]bool, width*height)
	queue := make([]int, 0, width*height)
	visit := func(index int) {
		if background[index] {
			return
		}
		pixel := source.NRGBAAt(index%width, index/width)
		if pixel.A >= 128 && !windowsTaskbarNeutralLight(pixel) {
			return
		}
		background[index] = true
		queue = append(queue, index)
	}
	for x := 0; x < width; x++ {
		visit(x)
		visit((height-1)*width + x)
	}
	for y := 0; y < height; y++ {
		visit(y * width)
		visit(y*width + width - 1)
	}
	for next := 0; next < len(queue); next++ {
		index := queue[next]
		x, y := index%width, index/width
		if x > 0 {
			visit(index - 1)
		}
		if x+1 < width {
			visit(index + 1)
		}
		if y > 0 {
			visit(index - width)
		}
		if y+1 < height {
			visit(index + width)
		}
	}
	foreground := make([]bool, len(background))
	for index := range foreground {
		foreground[index] = !background[index] && source.NRGBAAt(index%width, index/width).A >= 128
	}
	return foreground
}

func windowsTaskbarMaskBounds(mask []bool, width, height int) image.Rectangle {
	box := image.Rectangle{}
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			if mask[y*width+x] {
				box = box.Union(image.Rect(x, y, x+1, y+1))
			}
		}
	}
	return box
}
