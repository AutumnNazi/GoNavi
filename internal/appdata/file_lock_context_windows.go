//go:build windows

package appdata

import (
	"errors"

	"golang.org/x/sys/windows"
)

func tryFileLockContext(lock *bootstrapFileLock) (bool, error) {
	err := windows.LockFileEx(
		windows.Handle(lock.file.Fd()),
		windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY,
		0,
		1,
		0,
		&lock.overlapped,
	)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, windows.ERROR_LOCK_VIOLATION) {
		return false, nil
	}
	return false, err
}
