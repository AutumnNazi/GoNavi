// Package dataexport implements bounded, lossless result serialization.
package dataexport

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"unicode/utf8"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// ErrInvalidCSVEncoding identifies unsupported encoding options.
var ErrInvalidCSVEncoding = errors.New("unsupported csv encoding")

// ErrCSVEncoding identifies encoding or output failures.
var ErrCSVEncoding = errors.New("csv encoding failed")

// ValidateCSVEncoding checks the exact public encoding contract. Empty means UTF-8 BOM.
func ValidateCSVEncoding(name string) error {
	switch name {
	case "", "utf-8", "utf-8-bom", "gbk", "gb18030", "utf-16le":
		return nil
	default:
		return fmt.Errorf("%w: %q", ErrInvalidCSVEncoding, name)
	}
}

// CSV writes complete CSV records through a strict encoder without closing its output.
type CSV struct {
	writer  *csv.Writer
	encoder *transform.Writer
	closed  bool
}

// NewCSV creates a CSV stream, writing its BOM exactly once.
func NewCSV(output io.Writer, name string) (*CSV, error) {
	if err := ValidateCSVEncoding(name); err != nil {
		return nil, err
	}
	var codec encoding.Encoding
	var bom []byte
	switch name {
	case "", "utf-8-bom":
		bom = []byte{0xef, 0xbb, 0xbf}
	case "gbk":
		codec = simplifiedchinese.GBK
	case "gb18030":
		codec = simplifiedchinese.GB18030
	case "utf-16le":
		bom = []byte{0xff, 0xfe}
		codec = unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM)
	}
	if len(bom) > 0 {
		n, err := output.Write(bom)
		if err == nil && n != len(bom) {
			err = io.ErrShortWrite
		}
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrCSVEncoding, err)
		}
	}
	stream := &CSV{}
	if codec != nil {
		stream.encoder = transform.NewWriter(output, codec.NewEncoder())
		output = stream.encoder
	}
	stream.writer = csv.NewWriter(output)
	return stream, nil
}

// Write serializes a CSV record with the configured encoding.
func (w *CSV) Write(record []string) error {
	if w.closed {
		return fmt.Errorf("%w: stream closed", ErrCSVEncoding)
	}
	for _, value := range record {
		if !utf8.ValidString(value) {
			return fmt.Errorf("%w: invalid utf-8 input", ErrCSVEncoding)
		}
	}
	if err := w.writer.Write(record); err != nil {
		return fmt.Errorf("%w: %w", ErrCSVEncoding, err)
	}
	return nil
}

// Close flushes CSV buffering and the encoder, preserving output errors.
func (w *CSV) Close() error {
	if w.closed {
		return nil
	}
	w.closed = true
	w.writer.Flush()
	err := w.writer.Error()
	if w.encoder != nil {
		err = errors.Join(err, w.encoder.Close())
	}
	if err != nil {
		return fmt.Errorf("%w: %w", ErrCSVEncoding, err)
	}
	return nil
}
