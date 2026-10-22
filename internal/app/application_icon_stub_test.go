//go:build !windows && (!darwin || !cgo)

package app

import (
	"context"
	"testing"
)

func TestSetApplicationIconPNGIsExplicitlyUnsupportedOutsideNativePlatforms(t *testing.T) {
	if _, err := setApplicationIconPNG([]byte{0x89}, t.TempDir(), context.Background()); err == nil {
		t.Fatal("expected unsupported-platform error")
	}
}
