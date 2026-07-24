//go:build !darwin

package app

import "errors"

func setApplicationIconPNG(png []byte) error {
	_ = png
	return errors.New("application icon updates are only supported on macOS")
}
