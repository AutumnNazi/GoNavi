package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestPluginExportAtomicGuardRunsAfterSyncClose(t *testing.T) {
	root := t.TempDir()
	destination := filepath.Join(root, "result.txt")
	if err := os.WriteFile(destination, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	target, err := createAtomicExportTarget(destination)
	if err != nil {
		t.Fatal(err)
	}
	defer target.abort()
	if _, err := target.file.Write([]byte("new")); err != nil {
		t.Fatal(err)
	}
	veto := errors.New("generation revoked")
	err = target.commitWithCheck(context.Background(), func() error {
		if !target.closed {
			t.Fatal("guard ran before file close")
		}
		return veto
	})
	if !errors.Is(err, veto) || target.replaceAttempted {
		t.Fatal("precommit veto entered replacement")
	}
	content, err := os.ReadFile(destination)
	if err != nil || string(content) != "old" {
		t.Fatal("precommit veto changed prior target")
	}
}

func TestPluginExportAtomicReplaceErrorMarksUnknownStage(t *testing.T) {
	root := t.TempDir()
	destination := filepath.Join(root, "existing-directory")
	if err := os.Mkdir(destination, 0o700); err != nil {
		t.Fatal(err)
	}
	target, err := createAtomicExportTarget(destination)
	if err != nil {
		t.Fatal(err)
	}
	defer target.abort()
	if _, err := target.file.Write([]byte("new")); err != nil {
		t.Fatal(err)
	}
	if err := target.commitWithCheck(context.Background(), func() error { return nil }); err == nil || !target.replaceAttempted {
		t.Fatal("failed replacement did not preserve unknown-outcome stage")
	}
	if info, err := os.Stat(destination); err != nil || !info.IsDir() {
		t.Fatal("replacement failure deleted destination")
	}
}
