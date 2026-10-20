package fontgallery

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
	return &codedError{code: code, err: fmt.Errorf("font gallery: %w", err)}
}

// ErrorCode returns stable machine codes used by the binding layer.
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
