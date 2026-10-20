//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || windows

package appdata

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestAcquireFileLockContextProcessHolder(t *testing.T) {
	path := os.Getenv("GONAVI_CONTEXT_LOCK_TEST_PATH")
	if path == "" {
		return
	}
	lock, err := AcquireFileLock(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := lock.Close(); err != nil {
			t.Error(err)
		}
	}()
	if _, err := fmt.Fprintln(os.Stdout, "locked"); err != nil {
		t.Fatal(err)
	}
	var release [1]byte
	if _, err := io.ReadFull(os.Stdin, release[:]); err != nil {
		t.Fatal(err)
	}
}

func TestAcquireFileLockContextCrossProcess(t *testing.T) {
	path := filepath.Join(t.TempDir(), "process.lock")
	processCtx, processCancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(processCancel)
	cmd := exec.CommandContext(processCtx, os.Args[0], "-test.run=^TestAcquireFileLockContextProcessHolder$")
	cmd.Env = append(os.Environ(), "GONAVI_CONTEXT_LOCK_TEST_PATH="+path)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := stdin.Close(); err != nil {
			t.Error(err)
		}
		if err := cmd.Wait(); err != nil {
			t.Errorf("lock holder: %v: %s", err, stderr.String())
		}
	})
	ready, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || ready != "locked\n" {
		t.Fatalf("lock holder readiness = %q, error = %v", ready, err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
		lock, err := AcquireFileLockContext(ctx, path)
		cancel()
		if lock != nil {
			if err := lock.Close(); err != nil {
				t.Error(err)
			}
			t.Fatal("another process's lock was acquired or released by a canceled waiter")
		}
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("contended error = %v, want deadline exceeded", err)
		}
	}
	// Release the child while acquisition is waiting, proving retries can succeed.
	// One callback result is buffered so the timer never waits on the acquiring caller.
	released := make(chan error, 1)
	timer := time.AfterFunc(30*time.Millisecond, func() {
		_, err := stdin.Write([]byte{1})
		released <- err
	})
	defer timer.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	lock, err := AcquireFileLockContext(ctx, path)
	if releaseErr := <-released; releaseErr != nil {
		t.Error(releaseErr)
	}
	if err != nil {
		t.Fatalf("acquire after child release: %v", err)
	}
	if err := lock.Close(); err != nil {
		t.Fatal(err)
	}
}
