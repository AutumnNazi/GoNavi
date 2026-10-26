package plugin

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestEncodeResponseReplacesOversizedMultibyteResult(t *testing.T) {
	small, err := encodeResponse(json.RawMessage("1"), strings.Repeat("文", 100), nil, DefaultMaxFrameBytes)
	if err != nil || !bytes.Contains(small, []byte("文")) || len(small) > DefaultMaxFrameBytes+1 {
		t.Fatal(err)
	}
	frame, err := encodeResponse(json.RawMessage("1"), strings.Repeat("文", 400000), nil, DefaultMaxFrameBytes)
	if err != nil || len(frame) > DefaultMaxFrameBytes+1 || !bytes.Contains(frame, []byte("response exceeds frame limit")) || bytes.Contains(frame, []byte("文")) {
		t.Fatalf("oversized result leaked: %d %v", len(frame), err)
	}
}
