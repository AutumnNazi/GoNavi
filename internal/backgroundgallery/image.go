package backgroundgallery

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"image"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/webp"
)

func verifyImage(payload []byte, a Asset) error {
	if int64(len(payload)) != a.SizeBytes {
		return failure("integrity", "image size mismatch")
	}
	sum := sha256.Sum256(payload)
	if hex.EncodeToString(sum[:]) != a.SHA256 {
		return failure("integrity", "image hash mismatch")
	}
	// WebP DecodeConfig may trust VP8X while Decode allocates from VP8/VP8L.
	// Validate every allocation-driving header before calling either decoder.
	if isWebP(payload) {
		width, height, ok := staticWebPDimensions(payload)
		if !ok || width != a.Width || height != a.Height {
			return failure("integrity", "invalid webp layout or dimensions")
		}
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(payload))
	if err != nil {
		return wrap("integrity", err)
	}
	expected := map[string]string{"image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp"}[a.MIMEType]
	if format != expected || config.Width != a.Width || config.Height != a.Height || int64(config.Width)*int64(config.Height) > maxPixels {
		return failure("integrity", "image format or dimensions mismatch")
	}
	if !staticRaster(payload, format) {
		return failure("integrity", "animated or malformed raster")
	}
	decoded, decodedFormat, err := image.Decode(bytes.NewReader(payload))
	if err != nil {
		return wrap("integrity", err)
	}
	if decodedFormat != expected || decoded.Bounds() != image.Rect(0, 0, a.Width, a.Height) {
		return failure("integrity", "decoded image dimensions mismatch")
	}
	return nil
}
func staticRaster(payload []byte, format string) bool {
	switch format {
	case "png":
		for offset := 8; offset+12 <= len(payload); {
			size := int64(binary.BigEndian.Uint32(payload[offset : offset+4]))
			end := int64(offset) + size + 12
			if end > int64(len(payload)) {
				return false
			}
			kind := string(payload[offset+4 : offset+8])
			if kind == "acTL" || kind == "fcTL" || kind == "fdAT" {
				return false
			}
			if kind == "IEND" {
				return end == int64(len(payload))
			}
			offset = int(end)
		}
		return false
	case "webp":
		_, _, ok := staticWebPDimensions(payload)
		return ok
	default:
		return format == "jpeg"
	}
}
func (s *Service) verifiedAsset(a Asset) ([]byte, error) {
	payload, err := s.readFile(a.Path, maxImageBytes)
	if err != nil {
		return nil, wrap("integrity", err)
	}
	if err := verifyImage(payload, a); err != nil {
		return nil, err
	}
	return payload, nil
}
