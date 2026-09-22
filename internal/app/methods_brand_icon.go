package app

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	_ "image/png"
	"strings"
	"sync"
)

const applicationBrandIconMaxPNGBytes = 4 * 1024 * 1024

var applicationBrandIconMu sync.Mutex

var (
	errApplicationBrandIconPayloadEmpty   = errors.New("empty icon payload")
	errApplicationBrandIconPayloadInvalid = errors.New("invalid PNG icon payload")
)

func decodeApplicationBrandIconPayload(imageBase64 string) ([]byte, error) {
	raw := strings.TrimSpace(imageBase64)
	if raw == "" {
		return nil, errApplicationBrandIconPayloadEmpty
	}
	if idx := strings.Index(raw, ","); idx >= 0 && strings.Contains(strings.ToLower(raw[:idx]), "base64") {
		raw = raw[idx+1:]
	}
	raw = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == ' ' || r == '\t' {
			return -1
		}
		return r
	}, raw)
	if raw == "" {
		return nil, errApplicationBrandIconPayloadEmpty
	}
	if len(raw) > base64.StdEncoding.EncodedLen(applicationBrandIconMaxPNGBytes+1) {
		return nil, fmt.Errorf("%w: payload exceeds %d MiB", errApplicationBrandIconPayloadInvalid, applicationBrandIconMaxPNGBytes/(1024*1024))
	}

	var decodeErr error
	for _, encoding := range []*base64.Encoding{
		base64.StdEncoding,
		base64.RawStdEncoding,
		base64.URLEncoding,
		base64.RawURLEncoding,
	} {
		png, err := encoding.DecodeString(raw)
		if err != nil {
			decodeErr = err
			continue
		}
		if len(png) > applicationBrandIconMaxPNGBytes {
			return nil, fmt.Errorf("%w: decoded image exceeds %d MiB", errApplicationBrandIconPayloadInvalid, applicationBrandIconMaxPNGBytes/(1024*1024))
		}
		if _, format, err := image.DecodeConfig(bytes.NewReader(png)); err != nil || format != "png" {
			if err != nil {
				return nil, fmt.Errorf("%w: %v", errApplicationBrandIconPayloadInvalid, err)
			}
			return nil, fmt.Errorf("%w: expected PNG image", errApplicationBrandIconPayloadInvalid)
		}
		return png, nil
	}

	return nil, fmt.Errorf("%w: %v", errApplicationBrandIconPayloadInvalid, decodeErr)
}
