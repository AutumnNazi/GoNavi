package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

func testDMLSnapshotEntry(id string, createdAt time.Time, complete bool) dmlSnapshotEntry {
	skipped := []db.SkippedReverseRow(nil)
	if !complete {
		skipped = []db.SkippedReverseRow{{
			Group: "insert", Index: 0, Reason: "data_grid.reverse.skip.missing_locator",
		}}
	}
	return dmlSnapshotEntry{
		ID:        id,
		CreatedAt: createdAt.Format(time.RFC3339),
		Table:     "t_pay",
		Changes: connection.ChangeSet{
			Deletes:         []map[string]interface{}{{"id": 3}},
			PreviousDeletes: []map[string]interface{}{{"id": 3, "name": "gone"}},
		},
		Reverse: db.ChangeReverseResult{
			Inserts:  []string{"INSERT INTO `t_pay` (`id`, `name`) VALUES (3, 'gone');"},
			Skipped:  skipped,
			Complete: complete,
		},
	}
}

func TestDMLSnapshotStoreAppendAndListNewestFirst(t *testing.T) {
	dir := t.TempDir()
	store := newDMLSnapshotStore(dir)

	base := time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC)
	for index := 0; index < 3; index++ {
		if err := store.Append(testDMLSnapshotEntry(
			"snap-"+string(rune('a'+index)), base.Add(time.Duration(index)*time.Minute), true)); err != nil {
			t.Fatalf("append %d: %v", index, err)
		}
	}

	entries, err := store.List()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}
	// List 必须按时间倒序，前端直接按返回顺序展示。
	if entries[0].ID != "snap-c" || entries[2].ID != "snap-a" {
		t.Fatalf("entries not newest-first: %s .. %s", entries[0].ID, entries[2].ID)
	}
}

// 快照要能被原样读回：反向语句与 previousDeletes 是还原的唯一依据。
func TestDMLSnapshotStoreRoundTripsReverseStatements(t *testing.T) {
	dir := t.TempDir()
	store := newDMLSnapshotStore(dir)

	entry := testDMLSnapshotEntry("snap-round-trip", time.Now(), false)
	if err := store.Append(entry); err != nil {
		t.Fatalf("append: %v", err)
	}

	entries, err := store.List()
	if err != nil || len(entries) != 1 {
		t.Fatalf("list returned %d entries, err=%v", len(entries), err)
	}
	got := entries[0]
	if len(got.Reverse.Inserts) != 1 || got.Reverse.Inserts[0] != entry.Reverse.Inserts[0] {
		t.Fatalf("reverse inserts lost: %#v", got.Reverse.Inserts)
	}
	if got.Reverse.Complete {
		t.Fatal("incomplete snapshot must not round-trip as complete")
	}
	if len(got.Reverse.Skipped) != 1 {
		t.Fatalf("skipped reasons lost: %#v", got.Reverse.Skipped)
	}
	if len(got.Changes.PreviousDeletes) != 1 {
		t.Fatalf("previousDeletes lost: %#v", got.Changes.PreviousDeletes)
	}
}

// 超过条数上限时裁剪最旧的条目。
func TestDMLSnapshotStorePrunesOldestBeyondLimit(t *testing.T) {
	dir := t.TempDir()
	store := newDMLSnapshotStore(dir)

	base := time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC)
	total := dmlSnapshotMaxEntries + 5
	for index := 0; index < total; index++ {
		entry := testDMLSnapshotEntry("snap", base.Add(time.Duration(index)*time.Second), true)
		if err := store.Append(entry); err != nil {
			t.Fatalf("append %d: %v", index, err)
		}
	}

	entries, err := store.List()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != dmlSnapshotMaxEntries {
		t.Fatalf("expected %d entries after prune, got %d", dmlSnapshotMaxEntries, len(entries))
	}
	// 保留的应是最新的那批：裁剪后最旧条目不得早于第 5 条。
	oldestKept, err := time.Parse(time.RFC3339, entries[len(entries)-1].CreatedAt)
	if err != nil {
		t.Fatalf("parse createdAt: %v", err)
	}
	wantOldest := base.Add(5 * time.Second)
	if !oldestKept.Equal(wantOldest) {
		t.Fatalf("prune dropped the wrong end: oldest kept = %s, want %s", oldestKept, wantOldest)
	}
}

// 超过天数的条目必须被裁掉 —— 超期即不可恢复，UI 需要据此提示。
func TestDMLSnapshotStorePrunesEntriesOlderThanRetention(t *testing.T) {
	dir := t.TempDir()
	store := newDMLSnapshotStore(dir)

	fresh := time.Now().Add(-time.Hour)
	stale := time.Now().AddDate(0, 0, -(dmlSnapshotRetentionDays + 1))

	if err := store.Append(testDMLSnapshotEntry("snap-stale", stale, true)); err != nil {
		t.Fatalf("append stale: %v", err)
	}
	// 第二次写入触发裁剪。
	if err := store.Append(testDMLSnapshotEntry("snap-fresh", fresh, true)); err != nil {
		t.Fatalf("append fresh: %v", err)
	}

	entries, err := store.List()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 || entries[0].ID != "snap-fresh" {
		t.Fatalf("stale entry not pruned: %#v", entries)
	}
}

// 单行损坏不应让整个快照中心不可读。
func TestDMLSnapshotStoreSkipsCorruptLine(t *testing.T) {
	dir := t.TempDir()
	store := newDMLSnapshotStore(dir)
	if err := store.Append(testDMLSnapshotEntry("snap-good", time.Now(), true)); err != nil {
		t.Fatalf("append: %v", err)
	}

	filePath := filepath.Join(dir, dmlSnapshotDirName, dmlSnapshotFileName)
	existing, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	corrupted := append([]byte("{ this is not json\n"), existing...)
	if err := os.WriteFile(filePath, corrupted, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	entries, err := store.List()
	if err != nil {
		t.Fatalf("list must tolerate a corrupt line: %v", err)
	}
	if len(entries) != 1 || entries[0].ID != "snap-good" {
		t.Fatalf("good entry lost after corruption: %#v", entries)
	}
}

// 空目录（尚未产生任何快照）必须返回空列表而不是错误。
func TestDMLSnapshotStoreListOnEmptyDir(t *testing.T) {
	store := newDMLSnapshotStore(t.TempDir())
	entries, err := store.List()
	if err != nil {
		t.Fatalf("list on empty dir: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected no entries, got %d", len(entries))
	}
}
