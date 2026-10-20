package dataexport

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
)

func TestCSVEncodingBytes(t *testing.T) {
	cases := []struct {
		name  string
		bom   []byte
		codec encoding.Encoding
	}{
		{name: "", bom: []byte{0xef, 0xbb, 0xbf}},
		{name: "utf-8"},
		{name: "utf-8-bom", bom: []byte{0xef, 0xbb, 0xbf}},
		{name: "gbk", codec: simplifiedchinese.GBK},
		{name: "gb18030", codec: simplifiedchinese.GB18030},
		{name: "utf-16le", bom: []byte{0xff, 0xfe}, codec: unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var output bytes.Buffer
			writer, err := NewCSV(&output, tc.name)
			if err != nil {
				t.Fatal(err)
			}
			for _, record := range [][]string{{"标题", "ASCII"}, {"中文", "a,\"b\n下一行"}} {
				if err := writer.Write(record); err != nil {
					t.Fatal(err)
				}
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			raw := output.Bytes()
			if len(tc.bom) > 0 {
				if !bytes.HasPrefix(raw, tc.bom) {
					t.Fatalf("missing BOM: %x", raw)
				}
				raw = raw[len(tc.bom):]
			}
			if bytes.HasPrefix(raw, []byte{0xef, 0xbb, 0xbf}) || bytes.HasPrefix(raw, []byte{0xff, 0xfe}) {
				t.Fatal("extra BOM")
			}
			if tc.codec != nil {
				raw, err = tc.codec.NewDecoder().Bytes(raw)
				if err != nil {
					t.Fatal(err)
				}
			}
			if want := "标题,ASCII\n中文,\"a,\"\"b\n下一行\"\n"; string(raw) != want {
				t.Fatalf("got %q want %q", raw, want)
			}
		})
	}
}

type failedOutput struct{ err error }

func (w failedOutput) Write([]byte) (int, error) { return 0, w.err }

type shortOutput struct{}

func (shortOutput) Write(payload []byte) (int, error) { return len(payload) - 1, nil }

func TestCSVEncodingFailures(t *testing.T) {
	for _, name := range []string{"UTF-8", " utf-8 ", "latin1"} {
		if _, err := NewCSV(io.Discard, name); !errors.Is(err, ErrInvalidCSVEncoding) {
			t.Fatalf("name %q: %v", name, err)
		}
	}
	for _, tc := range []struct {
		name, value string
		wantErr     bool
	}{
		{"gbk", "😀", true}, {"gb18030", "😀", false}, {"utf-16le", "😀", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var output bytes.Buffer
			writer, err := NewCSV(&output, tc.name)
			if err != nil {
				t.Fatal(err)
			}
			err = errors.Join(writer.Write([]string{tc.value}), writer.Close())
			if errors.Is(err, ErrCSVEncoding) != tc.wantErr {
				t.Fatalf("got %v", err)
			}
			if tc.wantErr && strings.Contains(output.String(), "?") {
				t.Fatal("silently replaced unsupported character")
			}
		})
	}
	failure := errors.New("disk full")
	for _, name := range []string{"utf-8", "utf-8-bom", "gbk", "gb18030", "utf-16le"} {
		t.Run("write failure "+name, func(t *testing.T) {
			writer, err := NewCSV(failedOutput{failure}, name)
			if err == nil {
				err = errors.Join(writer.Write([]string{"中文"}), writer.Close())
			}
			if !errors.Is(err, failure) || !errors.Is(err, ErrCSVEncoding) {
				t.Fatalf("lost write error: %v", err)
			}
		})
	}
	if _, err := NewCSV(shortOutput{}, "utf-8-bom"); !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("short BOM: %v", err)
	}
}
