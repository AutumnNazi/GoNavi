package fontgallery

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"golang.org/x/image/font/sfnt"
)

func verifyFont(payload []byte, a Asset) error {
	if int64(len(payload)) != a.SizeBytes {
		return failure("integrity", "font size mismatch")
	}
	sum := sha256.Sum256(payload)
	if hex.EncodeToString(sum[:]) != a.SHA256 {
		return failure("integrity", "font hash mismatch")
	}
	if a.MIMEType == "font/woff2" {
		if len(payload) < 4 || string(payload[:4]) != "wOF2" {
			return failure("integrity", "invalid woff2 header")
		}
		return nil
	}
	collection, err := sfnt.ParseCollectionReaderAt(bytes.NewReader(payload))
	if err != nil {
		return wrap("integrity", err)
	}
	if collection.NumFonts() < 1 {
		return failure("integrity", "font collection is empty")
	}
	font, err := collection.Font(0)
	if err != nil {
		return wrap("integrity", err)
	}
	var buf sfnt.Buffer
	family, err := font.Name(&buf, sfnt.NameIDFamily)
	if err != nil || strings.TrimSpace(family) == "" {
		family, err = font.Name(&buf, sfnt.NameIDTypographicFamily)
	}
	if err != nil || strings.TrimSpace(family) == "" {
		return failure("integrity", "font family name is missing")
	}
	return nil
}

func (s *Service) verifiedAsset(a Asset) ([]byte, error) {
	payload, err := s.readFile(a.Path, maxFontBytes)
	if err != nil {
		return nil, wrap("integrity", err)
	}
	if err := verifyFont(payload, a); err != nil {
		return nil, err
	}
	return payload, nil
}
