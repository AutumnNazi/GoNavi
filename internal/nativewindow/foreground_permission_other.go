//go:build !windows

package nativewindow

func grantParentForegroundAccess() error {
	return nil
}
