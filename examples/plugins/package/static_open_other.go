//go:build !unix && !windows

package main

import (
	"fmt"
	"os"
)

func openStaticFile(string) (*os.File, error) {
	return nil, fmt.Errorf("static package safe file opening is unavailable on this platform")
}
