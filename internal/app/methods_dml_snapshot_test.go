package app

import (
	"testing"

	"GoNavi-Wails/internal/connection"
)

func newDMLSnapshotTestApp(t *testing.T) *App {
	t.Helper()
	application := NewAppWithSecretStore(nil)
	application.configDir = t.TempDir()
	return application
}

func mysqlDMLSnapshotConfig() connection.ConnectionConfig {
	return connection.ConnectionConfig{ID: "conn-1", Type: "mysql"}
}

// 完整的 before-image 必须落成一条可读回的快照，并把反向语句原样交给前端。
func TestCaptureDMLSnapshotStoresReverseStatements(t *testing.T) {
	application := newDMLSnapshotTestApp(t)

	changes := connection.ChangeSet{
		Deletes:         []map[string]interface{}{{"id": 3}},
		PreviousDeletes: []map[string]interface{}{{"id": 3, "name": "gone"}},
		Updates: []connection.UpdateRow{{
			Keys:           map[string]interface{}{"id": 7},
			Values:         map[string]interface{}{"name": "new"},
			PreviousValues: map[string]interface{}{"name": "old"},
		}},
	}
	application.captureDMLSnapshot(mysqlDMLSnapshotConfig(), "shop", "t_pay", changes)

	listResult := application.ListDMLSnapshots()
	if !listResult.Success {
		t.Fatalf("list failed: %s", listResult.Message)
	}
	summaries, ok := listResult.Data.([]DMLSnapshotSummary)
	if !ok || len(summaries) != 1 {
		t.Fatalf("expected 1 summary, got %#v", listResult.Data)
	}
	if summaries[0].Table != "t_pay" || summaries[0].CannotFullyRestore {
		t.Fatalf("unexpected summary: %#v", summaries[0])
	}
	if summaries[0].StatementCount != 2 {
		t.Fatalf("expected 2 statements, got %d", summaries[0].StatementCount)
	}

	detailResult := application.GetDMLSnapshot(summaries[0].ID)
	if !detailResult.Success {
		t.Fatalf("detail failed: %s", detailResult.Message)
	}
	detail, ok := detailResult.Data.(DMLSnapshotDetail)
	if !ok {
		t.Fatalf("unexpected detail payload: %#v", detailResult.Data)
	}
	// 反向语句必须已按 MySQL 反引号引用。
	if len(detail.Updates) != 1 || detail.Updates[0] != "UPDATE `t_pay` SET `name` = 'old' WHERE `id` = 7;" {
		t.Fatalf("unexpected reverse updates: %#v", detail.Updates)
	}
	if len(detail.Inserts) != 1 {
		t.Fatalf("unexpected reverse inserts: %#v", detail.Inserts)
	}
}

// 一条反向语句都产不出来时不落快照 —— 避免快照中心堆满点开才发现无法还原的记录。
func TestCaptureDMLSnapshotSkippedWhenNothingRestorable(t *testing.T) {
	application := newDMLSnapshotTestApp(t)

	// 删除行缺整行快照、更新行缺变更前值、插入行缺定位列：三类都还原不了。
	application.captureDMLSnapshot(mysqlDMLSnapshotConfig(), "shop", "t_pay", connection.ChangeSet{
		Deletes: []map[string]interface{}{{"id": 2}},
		Updates: []connection.UpdateRow{{
			Keys:   map[string]interface{}{"id": 3},
			Values: map[string]interface{}{"name": "new"},
		}},
		Inserts: []map[string]interface{}{{"id": 4, "name": "added"}},
	})

	listResult := application.ListDMLSnapshots()
	summaries, _ := listResult.Data.([]DMLSnapshotSummary)
	if len(summaries) != 0 {
		t.Fatalf("expected no snapshot when nothing is restorable, got %#v", summaries)
	}
}

// 纯 INSERT 的变更集没有 before-image（行此前不存在），但只要定位值已知，
// 反向 DELETE 就是精确的 —— 这类快照必须保留，不能被"有没有旧值"的判据误杀。
func TestCaptureDMLSnapshotKeepsInsertOnlyChangeSet(t *testing.T) {
	application := newDMLSnapshotTestApp(t)

	application.captureDMLSnapshot(mysqlDMLSnapshotConfig(), "shop", "t_pay", connection.ChangeSet{
		Inserts:        []map[string]interface{}{{"id": 100, "name": "explicit-pk"}},
		LocatorColumns: []connection.LocatorColumn{{Key: "id"}},
	})

	listResult := application.ListDMLSnapshots()
	summaries, _ := listResult.Data.([]DMLSnapshotSummary)
	if len(summaries) != 1 {
		t.Fatalf("expected insert-only snapshot to be kept, got %#v", summaries)
	}
	if summaries[0].CannotFullyRestore {
		t.Fatal("insert with a known locator is fully restorable")
	}

	detail, _ := application.GetDMLSnapshot(summaries[0].ID).Data.(DMLSnapshotDetail)
	if len(detail.Deletes) != 1 {
		t.Fatalf("expected a reverse delete, got %#v", detail.Deletes)
	}
}

// 删除行的"整行快照"为 nil 时同样不可还原，不得落快照。
func TestCaptureDMLSnapshotSkippedForNilPreviousDelete(t *testing.T) {
	application := newDMLSnapshotTestApp(t)

	application.captureDMLSnapshot(mysqlDMLSnapshotConfig(), "shop", "t_pay", connection.ChangeSet{
		Deletes:         []map[string]interface{}{{"id": 2}},
		PreviousDeletes: []map[string]interface{}{nil},
	})

	listResult := application.ListDMLSnapshots()
	summaries, _ := listResult.Data.([]DMLSnapshotSummary)
	if len(summaries) != 0 {
		t.Fatalf("expected no snapshot when every row is unrestorable, got %#v", summaries)
	}
}

// 列快照而不给列名映射时，插入行必须被标为"无法完整还原"，不能假装成功。
func TestListDMLSnapshotsFlagsIncompleteRestore(t *testing.T) {
	application := newDMLSnapshotTestApp(t)

	application.captureDMLSnapshot(mysqlDMLSnapshotConfig(), "shop", "t_pay", connection.ChangeSet{
		Inserts:         []map[string]interface{}{{"name": "added"}},
		LocatorColumns:  []connection.LocatorColumn{{Key: "id"}},
		PreviousDeletes: []map[string]interface{}{{"id": 9, "name": "gone"}},
		Deletes:         []map[string]interface{}{{"id": 9}},
	})

	listResult := application.ListDMLSnapshots()
	summaries, _ := listResult.Data.([]DMLSnapshotSummary)
	if len(summaries) != 1 {
		t.Fatalf("expected 1 summary, got %#v", summaries)
	}
	// 删除行可还原（有整行快照），插入行缺定位值不可还原 → 整体不可完整还原。
	if !summaries[0].CannotFullyRestore {
		t.Fatal("snapshot with an unrestorable insert must be flagged")
	}
	if summaries[0].SkippedCount != 1 {
		t.Fatalf("expected 1 skipped row, got %d", summaries[0].SkippedCount)
	}
}

func TestGetDMLSnapshotRejectsEmptyID(t *testing.T) {
	application := newDMLSnapshotTestApp(t)
	result := application.GetDMLSnapshot("   ")
	if result.Success {
		t.Fatal("empty snapshot id must be rejected")
	}
}

// 快照已被保留策略清理时，必须明确报"不存在"，不能返回空详情让前端误以为可还原。
func TestGetDMLSnapshotReportsMissingID(t *testing.T) {
	application := newDMLSnapshotTestApp(t)
	result := application.GetDMLSnapshot("does-not-exist")
	if result.Success {
		t.Fatal("missing snapshot must not be reported as success")
	}
	if result.Message == "" {
		t.Fatal("missing snapshot must carry an explanatory message")
	}
}

// 空存储下列表为空且成功 —— 首次打开快照中心不应报错。
func TestListDMLSnapshotsOnEmptyStore(t *testing.T) {
	application := newDMLSnapshotTestApp(t)
	result := application.ListDMLSnapshots()
	if !result.Success {
		t.Fatalf("list on empty store must succeed: %s", result.Message)
	}
	summaries, _ := result.Data.([]DMLSnapshotSummary)
	if len(summaries) != 0 {
		t.Fatalf("expected empty list, got %#v", summaries)
	}
}
