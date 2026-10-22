//go:build linux

package nativewindow

import "syscall"

func pluginProcessAttributes() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGTERM}
}
