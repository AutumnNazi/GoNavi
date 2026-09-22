package app

import "testing"

func TestWindowsTaskbarIconPixelsMatchNeighborApps(t *testing.T) {
	if got := windowsTaskbarIconPixels(96); got != 24 {
		t.Fatalf("96 DPI taskbar icon = %d, want 24", got)
	}
	if got := windowsAltTabIconPixels(96); got != 32 {
		t.Fatalf("96 DPI Alt+Tab icon = %d, want 32", got)
	}
	if got := windowsTaskbarIconPixels(120); got < 32 {
		t.Fatalf("125%% taskbar icon = %d, want at least 32", got)
	}
	if got := windowsTaskbarIconPixels(192); got < 48 {
		t.Fatalf("200%% taskbar icon = %d, want at least 48", got)
	}
	if got := windowsTaskbarIconPixels(16); got != 24 {
		t.Fatalf("degenerate DPI must not fall back to a 16px taskbar icon, got %d", got)
	}
}
