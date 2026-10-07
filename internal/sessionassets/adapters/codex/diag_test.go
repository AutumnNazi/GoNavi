package codex

import (
	"os"
	"path/filepath"
	"testing"
)

func TestActiveFileHeader(t *testing.T) {
	root := filepath.Join(os.Getenv("USERPROFILE"), ".codex", "sessions")
	var active []string
	filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if len(active) < 5 {
			active = append(active, path)
		}
		return nil
	})
	if len(active) == 0 {
		t.Skip("no active files")
	}
	for _, path := range active {
		_, err := readSessionHeader(path, false)
		t.Logf("ACTIVE %s err=%v", filepath.Base(path), err)
	}
}
