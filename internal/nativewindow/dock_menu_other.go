//go:build !darwin || !cgo

package nativewindow

func supportsDetachedDockMenu() bool {
	return false
}

func installDetachedDockMenu() {}

func publishDetachedDockMenuSnapshotToPlatform([]byte, uint64) {}
