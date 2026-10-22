//go:build linux || darwin

package nativewindow

import (
	"os"
	"syscall"
)

func killPluginChildTree() {
	if syscall.Getpgrp() == os.Getpid() {
		if err := syscall.Kill(-os.Getpid(), syscall.SIGKILL); err == nil {
			return
		}
	}
	os.Exit(1)
}
