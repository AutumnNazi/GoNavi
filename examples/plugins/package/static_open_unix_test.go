//go:build unix

package main

import (
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestStaticRejectsAfterStatFIFOSwapWithoutBlocking(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "SKILL.md")
	if err := os.WriteFile(path, []byte("# Original"), 0600); err != nil {
		t.Fatal(err)
	}
	opener := func(path string) (*os.File, error) {
		if err := os.Remove(path); err != nil {
			return nil, err
		}
		if err := syscall.Mkfifo(path, 0600); err != nil {
			return nil, err
		}
		return openStaticFile(path)
	}
	// One terminal result must remain deliverable during timeout rescue and cleanup.
	done := make(chan error, 1)
	go func() {
		_, err := readStaticFileUsing(context.Background(), root, "SKILL.md", maxStaticSkillBytes, opener)
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("FIFO accepted as Skill document")
		}
	case <-time.After(time.Second):
		// Unblock a regressed blocking open before reporting failure; do not strand a test goroutine.
		descriptor, err := syscall.Open(path, syscall.O_RDWR|syscall.O_NONBLOCK, 0)
		if err != nil {
			t.Fatalf("FIFO open blocked and rescue failed: %v", err)
		}
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Error("FIFO reader did not finish after rescue")
		}
		if err = syscall.Close(descriptor); err != nil {
			t.Error(err)
		}
		t.Fatal("raced FIFO blocked final open")
	}
}
