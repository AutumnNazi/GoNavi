package backgroundgallery

import (
	"context"
	"errors"
	"fmt"
)

type codedError struct {
	code string
	err  error
}

func (e *codedError) Error() string     { return e.code + ": " + e.err.Error() }
func (e *codedError) Unwrap() error     { return e.err }
func failure(code, detail string) error { return &codedError{code: code, err: errors.New(detail)} }
func wrap(code string, err error) error {
	if err == nil {
		return nil
	}
	return &codedError{code: code, err: fmt.Errorf("background gallery: %w", err)}
}

// ErrorCode returns stable machine codes: invalid_catalog, invalid_id,
// unavailable, download_failed, integrity, canceled, or storage_failed.
// An unknown error maps to unavailable; nil maps to the empty string.
func ErrorCode(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.Canceled) {
		return "canceled"
	}
	var coded *codedError
	if errors.As(err, &coded) {
		return coded.code
	}
	return "unavailable"
}
