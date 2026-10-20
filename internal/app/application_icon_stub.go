//go:build !windows && (!darwin || !cgo)

package app

import (
	"context"
	"errors"
)

func setApplicationIconPNG(png []byte, _ string, _ context.Context) (bool, error) {
	_ = png
	return false, errors.New("application icon updates are only supported on macOS and Windows")
}
