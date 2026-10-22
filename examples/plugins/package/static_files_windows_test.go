package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

type reparseInfo struct{ attributes uint32 }

func (reparseInfo) Name() string       { return "SKILL.md" }
func (reparseInfo) Size() int64        { return 1 }
func (reparseInfo) Mode() os.FileMode  { return 0600 }
func (reparseInfo) ModTime() time.Time { return time.Time{} }
func (reparseInfo) IsDir() bool        { return false }
func (info reparseInfo) Sys() any {
	return &syscall.Win32FileAttributeData{FileAttributes: info.attributes}
}

func TestStaticRejectsWindowsReparseAttributeWithoutSymlinkMode(t *testing.T) {
	if !staticFileIsLink(reparseInfo{attributes: syscall.FILE_ATTRIBUTE_REPARSE_POINT}) {
		t.Fatal("reparse point accepted as an ordinary file")
	}
	if staticFileIsLink(reparseInfo{attributes: syscall.FILE_ATTRIBUTE_NORMAL}) {
		t.Fatal("ordinary Windows file rejected")
	}
}

func TestStaticWindowsLongPathOpen(t *testing.T) {
	root := t.TempDir()
	entry := strings.Repeat("a", 100) + "/" + strings.Repeat("b", 100) + "/SKILL.md"
	target := filepath.Join(root, filepath.FromSlash(entry))
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("# Long path"), 0600); err != nil {
		t.Fatal(err)
	}
	body, err := readStaticFile(context.Background(), root, entry, maxStaticSkillBytes)
	if err != nil || string(body) != "# Long path" {
		t.Fatalf("long path safe open: %v", err)
	}
}
