//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || windows

package appdata

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAcquireFileLockContextContended(t *testing.T) {
	for _, tt := range []struct {
		name     string
		deadline bool
		want     error
	}{
		{name: "canceled while waiting", want: context.Canceled},
		{name: "deadline while waiting", deadline: true, want: context.DeadlineExceeded},
	} {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "held.lock")
			held, err := AcquireFileLock(path)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := held.Close(); err != nil {
					t.Error(err)
				}
			})
			ctx, cancel := context.WithCancel(context.Background())
			if tt.deadline {
				cancel()
				ctx, cancel = context.WithTimeout(context.Background(), 50*time.Millisecond)
			} else {
				timer := time.AfterFunc(50*time.Millisecond, cancel)
				defer timer.Stop()
			}
			defer cancel()
			type result struct {
				lock *bootstrapFileLock
				err  error
			}
			// One result fits even if the timeout branch must release the holder first.
			finished := make(chan result, 1)
			go func() {
				lock, err := AcquireFileLockContext(ctx, path)
				finished <- result{lock: lock, err: err}
			}()
			timer := time.NewTimer(time.Second)
			defer timer.Stop()
			var got result
			select {
			case got = <-finished:
			case <-timer.C:
				if err := held.Close(); err != nil {
					t.Error(err)
				}
				got = <-finished
				if got.lock != nil {
					if err := got.lock.Close(); err != nil {
						t.Error(err)
					}
				}
				t.Fatal("acquisition did not return promptly after cancellation")
			}
			if got.lock != nil {
				if err := got.lock.Close(); err != nil {
					t.Error(err)
				}
				t.Fatal("contended acquisition returned a lock")
			}
			if !errors.Is(got.err, tt.want) {
				t.Fatalf("error = %v, want %v", got.err, tt.want)
			}
			probeCtx, probeCancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
			defer probeCancel()
			probe, err := AcquireFileLockContext(probeCtx, path)
			if probe != nil {
				if err := probe.Close(); err != nil {
					t.Error(err)
				}
				t.Fatal("canceled waiter released another owner's lock")
			}
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("holder no longer excludes another caller: %v", err)
			}
			if err := held.Close(); err != nil {
				t.Fatal(err)
			}
			freshCtx, freshCancel := context.WithTimeout(context.Background(), time.Second)
			defer freshCancel()
			fresh, err := AcquireFileLockContext(freshCtx, path)
			if err != nil {
				t.Fatalf("acquire after release: %v", err)
			}
			if err := fresh.Close(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestAcquireFileLockContextPathErrors(t *testing.T) {
	root := t.TempDir()
	for _, tt := range []struct {
		name string
		path string
	}{
		{name: "missing parent", path: filepath.Join(root, "missing", "lock")},
		{name: "directory", path: root},
		{name: "empty path", path: ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			lock, err := AcquireFileLockContext(ctx, tt.path)
			if lock != nil {
				if closeErr := lock.Close(); closeErr != nil {
					t.Error(closeErr)
				}
				t.Fatal("invalid path returned a lock")
			}
			var pathErr *os.PathError
			if !errors.As(err, &pathErr) {
				t.Fatalf("error = %v, want wrapped path error", err)
			}
		})
	}
	if _, err := os.Stat(filepath.Join(root, "missing")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("acquisition created parent directory: %v", err)
	}
}

func TestAcquireFileLockContextCancellationDoesNotReleaseAcquiredLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "owned.lock")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	lock, err := AcquireFileLockContext(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := lock.Close(); err != nil {
			t.Error(err)
		}
	})
	cancel()
	probeCtx, probeCancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer probeCancel()
	probe, err := AcquireFileLockContext(probeCtx, path)
	if probe != nil {
		if err := probe.Close(); err != nil {
			t.Error(err)
		}
		t.Fatal("canceling the acquisition context released an owned lock")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error = %v, want deadline exceeded", err)
	}
}

func TestAcquireFileLockContextAlreadyCanceled(t *testing.T) {
	for _, tt := range []struct {
		name     string
		deadline bool
		want     error
	}{
		{name: "canceled", want: context.Canceled},
		{name: "expired deadline", deadline: true, want: context.DeadlineExceeded},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			if tt.deadline {
				ctx, cancel = context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
				defer cancel()
			}
			path := filepath.Join(t.TempDir(), "unused.lock")
			lock, err := AcquireFileLockContext(ctx, path)
			if lock != nil {
				if closeErr := lock.Close(); closeErr != nil {
					t.Error(closeErr)
				}
				t.Fatal("canceled context returned a lock")
			}
			if !errors.Is(err, tt.want) {
				t.Fatalf("error = %v, want %v", err, tt.want)
			}
			if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("canceled acquisition touched lock path: %v", err)
			}
		})
	}
}
