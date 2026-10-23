package plugin

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func canonicalSkillPath(t *testing.T, path string) string {
	t.Helper()
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	return canonical
}

func TestSkillReadRejectsReparseDirectoryAndPackageRoot(t *testing.T) {
	for _, part := range []string{"skill parent", "package root", "store parent"} {
		t.Run(part, func(t *testing.T) {
			manager, status, _ := runningSkillManager(t)
			target := filepath.Join(manager.root, "store", status.Digest, "skills")
			if part == "package root" {
				target = filepath.Join(manager.root, "store", status.Digest)
			}
			if part == "store parent" {
				target = filepath.Join(manager.root, "store")
			}
			saved := filepath.Join(t.TempDir(), "saved-directory")
			if err := os.Rename(target, saved); err != nil {
				t.Fatal(err)
			}
			createSkillDirectoryLink(t, target, saved)
			// Linked bytes are identical: rejection must come from no-follow handles, not just a hash difference.
			result, err := manager.ReadSkillGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest)
			if err == nil || result != (SkillContent{}) {
				t.Fatalf("linked package path returned content: %v", err)
			}
		})
	}
}

func TestSkillHandleRemainsPinnedAcrossParentReplacement(t *testing.T) {
	root := canonicalSkillPath(t, t.TempDir())
	parent := filepath.Join(root, "parent")
	if err := os.Mkdir(parent, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(parent, "SKILL.md"), []byte("authenticated original"), 0600); err != nil {
		t.Fatal(err)
	}
	held, err := openPackageDirectory(context.Background(), parent)
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	replacement := filepath.Join(root, "outside")
	if err = os.Mkdir(replacement, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(replacement, "SKILL.md"), []byte("EXTERNAL REPLACEMENT"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(parent, filepath.Join(root, "original-parent")); err != nil {
		t.Fatal(err)
	}
	createSkillDirectoryLink(t, parent, replacement)
	file, err := openPackageChild(held, "SKILL.md", true)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, maxSkillBytes+1))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "authenticated original" {
		t.Fatal("child opening followed replaced parent pathname")
	}
	if unsafe, err := openPackageDirectory(context.Background(), parent); err == nil {
		unsafe.Close()
		t.Fatal("new parent traversal accepted a reparse/link replacement")
	}
}

func TestSkillFileLinkReplacedAfterDirectoryEnumerationIsRejected(t *testing.T) {
	root := canonicalSkillPath(t, t.TempDir())
	target := filepath.Join(root, "SKILL.md")
	if err := os.WriteFile(target, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	directory, err := openPackageDirectory(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer directory.Close()
	names, err := directory.Readdirnames(64)
	if err != nil && err != io.EOF {
		t.Fatal(err)
	}
	if len(names) != 1 || names[0] != "SKILL.md" {
		t.Fatalf("unexpected initial entries: %v", names)
	}
	outside := filepath.Join(t.TempDir(), "outside.md")
	if err = os.WriteFile(outside, []byte("external"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(target); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(outside, target); err != nil {
		t.Skipf("file symlink creation unavailable: %v", err)
	}
	if file, err := openPackageChild(directory, names[0], true); err == nil {
		file.Close()
		t.Fatal("enumeration/open race followed a replaced file link")
	}
}

func TestSkillRootAncestorAliasIsResolvedOnlyAtConstruction(t *testing.T) {
	parent := canonicalSkillPath(t, t.TempDir())
	original := filepath.Join(parent, "original")
	if err := os.Mkdir(original, 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(parent, "alias")
	createSkillDirectoryLink(t, alias, original)
	manager := managerAt(t, filepath.Join(alias, "plugins"))
	expected := canonicalSkillPath(t, filepath.Join(original, "plugins"))
	if manager.root != expected {
		t.Fatalf("root alias not canonicalized: %q != %q", manager.root, expected)
	}
	status := installSource(t, manager, skillPackage(t, skillManifest(), []byte("original authority")))
	enableFixture(t, manager, status.Manifest.ID)
	if err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	status = waitState(t, manager, status.Manifest.ID, StateRunning)
	if err := os.Remove(alias); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(parent, "replacement")
	if err := os.Mkdir(outside, 0700); err != nil {
		t.Fatal(err)
	}
	createSkillDirectoryLink(t, alias, outside)
	result, err := manager.ReadSkillGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest)
	if err != nil || result.Content != "original authority" {
		t.Fatalf("configured alias replacement redirected existing authority: %+v %v", result, err)
	}
}

func TestSkillReadHandlesCloseOnRepeatedFailure(t *testing.T) {
	manager, status, _ := runningSkillManager(t)
	// Warm scheduler threads and directory buffers before measuring all-process handles.
	for i := 0; i < 20; i++ {
		if _, err := manager.ReadSkillGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest); err != nil {
			t.Fatal(err)
		}
	}
	before := skillTestHandleCount(t)
	for i := 0; i < 100; i++ {
		canceled, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err := manager.ReadSkillGeneration(canceled, status.Manifest.ID, status.Generation, "guide", status.Digest); err == nil {
			t.Fatal("canceled read succeeded")
		}
		if _, err := manager.ReadSkillGeneration(context.Background(), status.Manifest.ID, status.Generation, "guide", status.Digest); err != nil {
			t.Fatal(err)
		}
	}
	after := skillTestHandleCount(t)
	if after > before+16 {
		t.Fatalf("skill reads leaked handles: before=%d after=%d", before, after)
	}
}
