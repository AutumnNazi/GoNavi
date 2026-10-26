//go:build windows

package nativewindow

import "os"

func killPluginChildTree() {
	// Exiting the root is observed by the host, which closes its kill-on-close job.
	os.Exit(1)
}
