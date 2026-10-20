package taskrollback

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestStoreKeepsTheOriginalReadyPoint(t *testing.T) {
	store := openRollbackStore(t)
	first := Point{ID: NewPointID(), Kind: KindSQLImport, TaskID: "import-1", Database: "igap_pro", WholeDatabase: true}
	path, err := store.Begin(first)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := os.WriteFile(path, []byte("snapshot-v1"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Commit(first.ID, 12); err != nil {
		t.Fatalf("commit: %v", err)
	}

	second := Point{ID: NewPointID(), Kind: KindSQLImport, TaskID: first.TaskID, Database: "other"}
	if _, err := store.Begin(second); !errors.Is(err, ErrExists) {
		t.Fatalf("second begin = %v, want ErrExists", err)
	}
	ready, err := store.ReadyByTask(first.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	if ready.ID != first.ID || ready.Database != "igap_pro" {
		t.Fatalf("ready point = %#v", ready)
	}
	payload, err := os.ReadFile(filepath.Join(store.root, first.ID, snapshotFileName))
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != "snapshot-v1" {
		t.Fatalf("snapshot replaced: %q", payload)
	}
}

func TestStoreAbortAndSweepRemoveUncommittedPoints(t *testing.T) {
	store := openRollbackStore(t)
	point := Point{ID: NewPointID(), Kind: KindTableImport, TaskID: "import-2", Database: "app"}
	if _, err := store.Begin(point); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(store.root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.ReadyByTask(point.TaskID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("writing point survived reopen: %v", err)
	}
	if _, err := os.Stat(filepath.Join(store.root, point.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("writing directory still exists: %v", err)
	}
}

func TestStoreRestoreIsSingleUse(t *testing.T) {
	store := openRollbackStore(t)
	point := Point{ID: NewPointID(), Kind: KindDataSync, TaskID: "sync-run-1", Database: "app"}
	if _, err := store.Begin(point); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Commit(point.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := store.TryStartRestore(point.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.TryStartRestore(point.ID); !errors.Is(err, ErrBusy) {
		t.Fatalf("concurrent restore = %v, want ErrBusy", err)
	}
	if err := store.FinishRestore(point.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ReadyByTask(point.TaskID); !errors.Is(err, ErrNotReady) {
		t.Fatalf("restored point still ready: %v", err)
	}
	if _, err := store.TryStartRestore(point.ID); !errors.Is(err, ErrNotReady) {
		t.Fatalf("second restore = %v, want ErrNotReady", err)
	}
}

func openRollbackStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "task-rollback"))
	if err != nil {
		t.Fatal(err)
	}
	return store
}
