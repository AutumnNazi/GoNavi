package plugin

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestSkillNativeHandleCloseAndRejectedOpenCleanup(t *testing.T) {
	root := canonicalSkillPath(t, t.TempDir())
	name := filepath.Join(root, "SKILL.md")
	if err := os.WriteFile(name, []byte("document"), 0600); err != nil {
		t.Fatal(err)
	}
	directory, err := openPackageDirectory(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer directory.Close()
	file, err := openPackageChild(directory, "SKILL.md", true)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	handle := file.Fd()
	assertSkillHeldHandleDetected(t, name, handle)
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
	assertSkillHandleClosed(t, handle)
	assertSkillRejectedOpenReleased(t, name, skillTestHandleCount(t))
	if err = os.Link(name, filepath.Join(root, "hardlink.md")); err != nil {
		t.Fatal(err)
	}
	reject := func() {
		t.Helper()
		if leaked, err := openPackageChild(directory, "SKILL.md", true); err == nil {
			leaked.Close()
			t.Fatal("hard link accepted")
		}
	}
	for i := 0; i < 20; i++ {
		reject()
	}
	before := skillTestHandleCount(t)
	for i := 0; i < 100; i++ {
		reject()
		assertSkillRejectedOpenReleased(t, name, before)
	}
	after := skillTestHandleCount(t)
	t.Logf("all-process handle diagnostic only: before=%d after=%d", before, after)
}
