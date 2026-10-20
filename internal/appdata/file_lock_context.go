//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || windows

package appdata

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"
)

const fileLockRetryInterval = 10 * time.Millisecond

// AcquireFileLockContext obtains an exclusive, cross-process lock for a
// caller-owned user app-data path, waiting until the lock is available or ctx
// is canceled. Like AcquireFileLock, it opens or creates path with mode 0600
// without creating parent directories or changing the selected data root.
// An already canceled context does not touch the filesystem. The caller must
// close the returned lock; cancellation does not release an acquired lock.
func AcquireFileLockContext(ctx context.Context, path string) (*bootstrapFileLock, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("acquire file lock: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open lock file: %w", err)
	}
	lock := &bootstrapFileLock{file: file}
	if err := waitForFileLockContext(ctx, lock); err != nil {
		// Close only this descriptor: a canceled waiter must not unlock its owner.
		return nil, fmt.Errorf("acquire file lock: %w", errors.Join(err, file.Close()))
	}
	// Preserve AcquireFileLock's best-effort permission tightening.
	_ = file.Chmod(0o600)
	return lock, nil
}

func waitForFileLockContext(ctx context.Context, lock *bootstrapFileLock) error {
	ticker := time.NewTicker(fileLockRetryInterval)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		acquired, err := tryFileLockContext(lock)
		if err != nil {
			return err
		}
		if acquired {
			// If cancellation raced with acquisition, closing the descriptor releases it.
			return ctx.Err()
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
