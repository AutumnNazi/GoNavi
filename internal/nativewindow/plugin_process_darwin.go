//go:build darwin

package nativewindow

import "syscall"

func pluginProcessAttributes() *syscall.SysProcAttr { return &syscall.SysProcAttr{Setpgid: true} }
