package backgroundgallery

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"image"
	"image/jpeg"
	"net/http"
	"testing"
)

func TestStaticJPEGAndWebPInstall(t *testing.T) {
	for _, format := range []string{"jpeg", "webp"} {
		t.Run(format, func(t *testing.T) {
			var payload []byte
			mimeType := "image/jpeg"
			extension := "jpg"
			if format == "jpeg" {
				var buffer bytes.Buffer
				if err := jpeg.Encode(&buffer, image.NewRGBA(image.Rect(0, 0, 2, 3)), nil); err != nil {
					t.Fatal(err)
				}
				payload = buffer.Bytes()
			} else {
				// Generated from a 2x3 solid red RGB image; no artwork fixture is embedded.
				var err error
				payload, err = hex.DecodeString("524946461c000000574542505650384c0f0000002f018000000710ed8bfe0722a2ff0100")
				if err != nil {
					t.Fatal(err)
				}
				mimeType = "image/webp"
				extension = "webp"
			}
			sum := sha256.Sum256(payload)
			hash := hex.EncodeToString(sum[:])
			entry := fixtureEntry()
			entry.Image = Asset{Path: "assets/" + hash + "." + extension, SHA256: hash, SizeBytes: int64(len(payload)), Width: 2, Height: 3, MIMEType: mimeType}
			entry.Thumbnail = entry.Image
			s, _, _ := galleryFixture(t, []Entry{entry}, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", mimeType)
				if _, err := w.Write(payload); err != nil {
					t.Error(err)
				}
			})
			if _, err := s.Download(context.Background(), entry.ID, entry.Version, nil); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Resolve(entry.ID, entry.Version); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestStaticRasterRejectsAnimationAndMalformedChunks(t *testing.T) {
	for _, test := range []struct{ name, format, hex string }{
		{"animated webp", "webp", "524946461600000057454250565038580a00000002000000010000020000"},
		{"webp bad chunk size", "webp", "524946460c000000574542505650384cffffffff"},
		{"webp missing chunk", "webp", "524946460400000057454250"},
		{"png bad chunk size", "png", "89504e470d0a1a0affffffff4948445200000000"},
	} {
		t.Run(test.name, func(t *testing.T) {
			payload, err := hex.DecodeString(test.hex)
			if err != nil {
				t.Fatal(err)
			}
			if staticRaster(payload, test.format) {
				t.Fatal("invalid static raster accepted")
			}
		})
	}
}
