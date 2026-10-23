//go:build !windows

package plugin

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func createSkillDirectoryLink(t *testing.T, link, target string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(link) })
}

// skillTestHandleCount reports how many descriptors this process currently holds. Enumerating
// /dev/fd on darwin fails as soon as one descriptor closes mid-scan, so live descriptors are
// probed one by one instead of relying on the platform's descriptor directory.
func skillTestHandleCount(t *testing.T) uint32 {
	t.Helper()
	limit := uint64(4096)
	var rl unix.Rlimit
	if err := unix.Getrlimit(unix.RLIMIT_NOFILE, &rl); err == nil && rl.Cur > 0 && rl.Cur < limit {
		limit = rl.Cur
	}
	count := uint32(0)
	for fd := uintptr(0); fd < uintptr(limit); fd++ {
		if _, err := unix.FcntlInt(fd, unix.F_GETFD, 0); err == nil {
			count++
		}
	}
	return count
}

func assertSkillHandleClosed(t *testing.T, handle uintptr) {
	t.Helper()
	if _, err := unix.FcntlInt(handle, unix.F_GETFD, 0); !errors.Is(err, unix.EBADF) {
		t.Fatalf("closed native descriptor remained usable: %v", err)
	}
}

func assertSkillHeldHandleDetected(t *testing.T, _ string, handle uintptr) {
	t.Helper()
	if _, err := unix.FcntlInt(handle, unix.F_GETFD, 0); err != nil {
		t.Fatalf("retained descriptor is not live: %v", err)
	}
}

func assertSkillRejectedOpenReleased(t *testing.T, _ string, before uint32) {
	t.Helper()
	if after := skillTestHandleCount(t); after > before+4 {
		t.Fatalf("rejected open leaked file descriptors: before=%d after=%d", before, after)
	}
}

func TestSkillFIFOReplacementCannotBlockRead(t *testing.T) {
	manager, status, _ := runningSkillManager(t)
	target := filepath.Join(manager.root, "store", status.Digest, "skills", "guide", "SKILL.md")
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(target, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	started := time.Now()
	result, err := manager.ReadSkillGeneration(ctx, status.Manifest.ID, status.Generation, "guide", status.Digest)
	if err == nil || result != (SkillContent{}) {
		t.Fatal("FIFO accepted as skill text")
	}
	if time.Since(started) > time.Second {
		t.Fatal("opening FIFO blocked on a writer")
	}
}
