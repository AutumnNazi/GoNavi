//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd

package appdata

import (
	"errors"
	"syscall"
)

func tryFileLockContext(lock *bootstrapFileLock) (bool, error) {
	err := syscall.Flock(int(lock.file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) || errors.Is(err, syscall.EINTR) {
		return false, nil
	}
	return false, err
}
