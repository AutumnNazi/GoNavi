//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd

package appdata

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAcquireFileLockContextPermissions(t *testing.T) {
	for _, existing := range []bool{false, true} {
		name := "new lock file"
		if existing {
			name = "existing lock file"
		}
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "private.lock")
			var content string
			if existing {
				content = "preserve existing contents"
				if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			lock, err := AcquireFileLockContext(context.Background(), path)
			if err != nil {
				t.Fatal(err)
			}
			if err := lock.Close(); err != nil {
				t.Fatal(err)
			}
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			if info.Mode().Perm() != 0o600 {
				t.Fatalf("permissions = %o, want 600", info.Mode().Perm())
			}
			got, err := os.ReadFile(path)
			if err != nil || string(got) != content {
				t.Fatalf("contents = %q, error = %v", got, err)
			}
		})
	}
}

func TestAcquireFileLockContextCanceledWaitersCloseDescriptors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "held.lock")
	held, err := AcquireFileLock(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := held.Close(); err != nil {
			t.Error(err)
		}
	}()
	before, err := os.ReadDir("/dev/fd")
	if err != nil {
		t.Skipf("descriptor enumeration unavailable: %v", err)
	}
	for attempt := 0; attempt < 32; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
		lock, err := AcquireFileLockContext(ctx, path)
		cancel()
		if lock != nil {
			if err := lock.Close(); err != nil {
				t.Error(err)
			}
			t.Fatal("contended acquisition returned a lock")
		}
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("error = %v, want deadline exceeded", err)
		}
	}
	after, err := os.ReadDir("/dev/fd")
	if err != nil {
		t.Fatal(err)
	}
	if len(after) > len(before) {
		t.Fatalf("canceled waiters leaked descriptors: before=%d after=%d", len(before), len(after))
	}
}
