//go:build windows

package app

import (
	"testing"

	"golang.org/x/sys/windows"
)

// COM resolves shortcut paths to long names, while Go may inherit an 8.3 TEMP
// path. Compare the same canonical spelling without weakening target checks.
func windowsCanonicalFixtureDirectory(t *testing.T) string {
	t.Helper()
	directory := t.TempDir()
	source, err := windows.UTF16PtrFromString(directory)
	if err != nil {
		t.Fatal(err)
	}
	buffer := make([]uint16, 32768)
	size, err := windows.GetLongPathName(source, &buffer[0], uint32(len(buffer)))
	if err != nil || size == 0 || int(size) >= len(buffer) {
		t.Fatalf("canonicalize fixture directory: size=%d err=%v", size, err)
	}
	return windows.UTF16ToString(buffer[:size])
}
