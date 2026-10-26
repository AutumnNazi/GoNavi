package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestStaticRejectsAfterStatSymlinkSwap(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "SKILL.md")
	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(path, []byte("# Original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outside, []byte("# Must not be copied"), 0600); err != nil {
		t.Fatal(err)
	}
	probe := filepath.Join(t.TempDir(), "probe")
	if err := os.Symlink(outside, probe); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}
	opener := func(path string) (*os.File, error) {
		if err := os.Remove(path); err != nil {
			return nil, err
		}
		if err := os.Symlink(outside, path); err != nil {
			return nil, err
		}
		return openStaticFile(path)
	}
	body, err := readStaticFileUsing(context.Background(), root, "SKILL.md", maxStaticSkillBytes, opener)
	if err == nil || body != nil {
		t.Fatal("after-stat symlink supplied package bytes")
	}
}
