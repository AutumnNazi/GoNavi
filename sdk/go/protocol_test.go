package plugin

import (
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestParseRequestShapes(t *testing.T) {
	for _, tt := range []struct {
		name, frame string
		code        int
	}{
		{name: "array is not a batch", frame: `[]`, code: -32600},
		{name: "scalar", frame: `42`, code: -32600},
		{name: "null", frame: `null`, code: -32600},
		{name: "bad syntax", frame: `{`, code: -32700},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseRequest([]byte(tt.frame))
			var rpc *Error
			if !errors.As(err, &rpc) || rpc.Code != tt.code {
				t.Fatalf("got %v, want %d", err, tt.code)
			}
		})
	}
}

func TestParseRequestRejectsInvalidUTF8(t *testing.T) {
	frame := []byte{123, 34, 120, 34, 58, 34, 255, 34, 125}
	_, err := parseRequest(frame)
	var rpc *Error
	if !errors.As(err, &rpc) || rpc.Code != -32700 {
		t.Fatalf("invalid UTF-8: %v", err)
	}
}

func TestEncodeResponseBoundsAndNilError(t *testing.T) {
	var typedNil *Error
	for _, tt := range []struct {
		name  string
		value any
		err   error
	}{
		{name: "unmarshalable result", value: make(chan int)},
		{name: "oversized result", value: strings.Repeat("x", 1024)},
		{name: "typed nil error", err: typedNil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			frame, err := encodeResponse(json.RawMessage("1"), tt.value, tt.err, 512)
			if err != nil {
				t.Fatal(err)
			}
			var reply response
			if err := json.Unmarshal(frame, &reply); err != nil {
				t.Fatal(err)
			}
			if reply.Error == nil || reply.Error.Code != -32603 || len(reply.Result) > 0 {
				t.Fatalf("invalid error envelope: %s", frame)
			}
		})
	}
}

type shortWriter struct{ written strings.Builder }

func (w *shortWriter) Write(p []byte) (int, error) {
	if len(p) > 2 {
		p = p[:2]
	}
	return w.written.Write(p)
}

type emptyWriter struct{}

func (emptyWriter) Write([]byte) (int, error) { return 0, nil }

func TestWriteFrameHandlesShortWrites(t *testing.T) {
	var writer shortWriter
	if err := writeFrame(&writer, []byte("abcdef\n")); err != nil {
		t.Fatal(err)
	}
	if got := writer.written.String(); got != "abcdef\n" {
		t.Fatalf("write truncated: %q", got)
	}
	if err := writeFrame(emptyWriter{}, []byte("x")); !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("zero write: %v", err)
	}
}
