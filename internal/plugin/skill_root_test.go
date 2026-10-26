package plugin

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSkillStorageRejectsFinalReparseRootBeforeWritingChildren(t *testing.T) {
	parent := canonicalSkillPath(t, t.TempDir())
	target := filepath.Join(parent, "target")
	if err := os.Mkdir(target, 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(parent, "alias")
	createSkillDirectoryLink(t, alias, target)
	manager, err := NewManager(Options{Root: alias})
	if err == nil {
		manager.Close(context.Background())
		t.Fatal("final reparse storage root accepted")
	}
	if _, err = os.Stat(filepath.Join(target, "store")); !os.IsNotExist(err) {
		t.Fatal("rejected storage root created children outside its boundary")
	}
}

func TestSkillStorageLongCanonicalRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), strings.Repeat("a", 95), strings.Repeat("b", 95), strings.Repeat("c", 95))
	manager := managerAt(t, root)
	status := installSource(t, manager, skillPackage(t, skillManifest(), []byte("long root authenticated text")))
	enableFixture(t, manager, status.Manifest.ID)
	if err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	status = waitState(t, manager, status.Manifest.ID, StateRunning)
	content, err := manager.ReadSkillGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest)
	if err != nil || content.Content != "long root authenticated text" {
		t.Fatalf("long storage root failed: %v", err)
	}
}
