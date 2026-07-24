package app

import (
	"encoding/base64"
	"errors"
	"testing"
)

const validBrandIconPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9dgAAAABJRU5ErkJggg=="

func TestDecodeApplicationBrandIconPayloadAcceptsDataURLAndURLSafeBase64(t *testing.T) {
	want, err := base64.StdEncoding.DecodeString(validBrandIconPNGBase64)
	if err != nil {
		t.Fatalf("decode fixture: %v", err)
	}

	for name, payload := range map[string]string{
		"data URL": "data:image/png;base64,\n" + validBrandIconPNGBase64,
		"URL-safe": base64.RawURLEncoding.EncodeToString(want),
	} {
		t.Run(name, func(t *testing.T) {
			got, err := decodeApplicationBrandIconPayload(payload)
			if err != nil {
				t.Fatalf("decode payload: %v", err)
			}
			if string(got) != string(want) {
				t.Fatal("decoded payload did not match fixture")
			}
		})
	}
}

func TestDecodeApplicationBrandIconPayloadRejectsEmptyInvalidAndOversizedInput(t *testing.T) {
	if _, err := decodeApplicationBrandIconPayload("  "); !errors.Is(err, errApplicationBrandIconPayloadEmpty) {
		t.Fatalf("empty payload error = %v, want empty payload error", err)
	}

	invalidPNG := base64.StdEncoding.EncodeToString([]byte("not a PNG"))
	if _, err := decodeApplicationBrandIconPayload(invalidPNG); !errors.Is(err, errApplicationBrandIconPayloadInvalid) {
		t.Fatalf("invalid PNG error = %v, want invalid payload error", err)
	}

	overLimit := make([]byte, base64.StdEncoding.EncodedLen(applicationBrandIconMaxPNGBytes+1)+1)
	for index := range overLimit {
		overLimit[index] = 'A'
	}
	if _, err := decodeApplicationBrandIconPayload(string(overLimit)); !errors.Is(err, errApplicationBrandIconPayloadInvalid) {
		t.Fatalf("oversized payload error = %v, want invalid payload error", err)
	}
}
