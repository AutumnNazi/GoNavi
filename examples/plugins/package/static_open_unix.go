//go:build unix

package main

import (
	"os"
	"syscall"
)

func openStaticFile(path string) (*os.File, error) {
	// Nonblocking open prevents a raced FIFO from hanging before the regular-file check.
	descriptor, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, os.NewSyscallError("open static entry", err)
	}
	return os.NewFile(uintptr(descriptor), path), nil
}
