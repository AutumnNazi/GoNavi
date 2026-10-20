//go:build windows

package app

import (
	"bytes"
	"context"
	"errors"
	"image/png"
	"testing"
)

func TestWindowsTaskbarAndAltTabRequestedFramesAcrossDPI(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, taskbarArtworkFixture(false, true)); err != nil {
		t.Fatal(err)
	}
	path, err := persistWindowsApplicationIcon(encoded.Bytes(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	originalLoad := windowsApplicationIconLoad
	originalDPI := windowsApplicationIconSystemDPI
	originalDestroy := windowsApplicationIconDestroyCall
	t.Cleanup(func() {
		windowsApplicationIconLoad = originalLoad
		windowsApplicationIconSystemDPI = originalDPI
		windowsApplicationIconDestroyCall = originalDestroy
	})
	for _, tt := range []struct {
		name  string
		dpi   int
		small int
		large int
	}{
		{name: "100-percent", dpi: 96, small: 24, large: 32},
		{name: "125-percent", dpi: 120, small: 32, large: 48},
		{name: "150-percent", dpi: 144, small: 48, large: 48},
		{name: "175-percent", dpi: 168, small: 48, large: 64},
		{name: "200-percent", dpi: 192, small: 48, large: 64},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var requested []int
			var destroyed []uintptr
			stop := errors.New("stop after both requested icon frames")
			windowsApplicationIconSystemDPI = func() int { return tt.dpi }
			windowsApplicationIconDestroyCall = func(icon uintptr) { destroyed = append(destroyed, icon) }
			windowsApplicationIconLoad = func(iconPath string, pixels int) (uintptr, error) {
				if iconPath != path {
					t.Errorf("native window used a different icon identity: %q", iconPath)
				}
				requested = append(requested, pixels)
				if len(requested) == 1 {
					return 17, nil
				}
				return 0, stop
			}
			if _, _, err := setCurrentWindowsApplicationIconMode(context.Background(), path, false); !errors.Is(err, stop) {
				t.Fatalf("unexpected native load result: %v", err)
			}
			if len(requested) != 2 || requested[0] != tt.small || requested[1] != tt.large {
				t.Fatalf("dpi=%d requested=%v want=%v", tt.dpi, requested, []int{tt.small, tt.large})
			}
			if len(destroyed) != 1 || destroyed[0] != 17 {
				t.Fatalf("failed large-frame load leaked the small native icon: %v", destroyed)
			}
		})
	}
}
