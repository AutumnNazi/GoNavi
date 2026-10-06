package sessionassets

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// N3 回归：v3 迁移重建 assets 表时，外键级联不得清空 source_refs 与
// capture_jobs（N3：DROP TABLE assets 在 foreign_keys=ON 下触发隐式
// 级联删除，导致全部来源引用与排队任务丢失）。
func TestV3MigrationPreservesRefsAndJobs(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "catalog.sqlite")
	db, err := sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	// 手工构造 v1 库并写入 integration/source/asset/ref/job 行。
	v1Statements := catalogMigrations[1]
	for _, statement := range v1Statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("v1 statement: %v", err)
		}
	}
	if _, err := db.Exec(`PRAGMA user_version = 1`); err != nil {
		t.Fatalf("set version: %v", err)
	}
	seed := []string{
		`INSERT INTO integrations (id, kind, display_name, enabled, created_at, updated_at)
		 VALUES ('int-1', 'codex', 'Codex', 1, 1, 1)`,
		`INSERT INTO sources (id, integration_id, root_path, identity_key, created_at, updated_at)
		 VALUES ('src-1', 'int-1', 'C:/x', 'dir:c-/x', 1, 1)`,
		`INSERT INTO assets (id, integration_id, native_thread_id, created_at, updated_at, first_seen_at, last_seen_at)
		 VALUES ('asset-1', 'int-1', 'th-1', 1, 1, 1, 1)`,
		`INSERT INTO source_refs (asset_id, source_id, native_path, source_status, last_seen_at)
		 VALUES ('asset-1', 'src-1', 'C:/x/a.jsonl', 'archived', 5)`,
		`INSERT INTO capture_jobs (id, asset_id, trigger_kind, status, request_json, created_at, updated_at)
		 VALUES ('job-1', 'asset-1', 'archive_event', 'queued', '{}', 1, 1)`,
	}
	for _, statement := range seed {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	_ = db.Close()

	// 通过 OpenCatalog 触发 v1→v3 迁移。
	catalog, err := OpenCatalog(dbPath)
	if err != nil {
		t.Fatalf("open migrated catalog: %v", err)
	}
	defer catalog.Close()

	var refCount, jobCount int
	if err := catalog.db.QueryRow(`SELECT COUNT(*) FROM source_refs`).Scan(&refCount); err != nil {
		t.Fatalf("count refs: %v", err)
	}
	if err := catalog.db.QueryRow(`SELECT COUNT(*) FROM capture_jobs`).Scan(&jobCount); err != nil {
		t.Fatalf("count jobs: %v", err)
	}
	if refCount != 1 || jobCount != 1 {
		t.Fatalf("v3 migration lost rows: refs=%d jobs=%d", refCount, jobCount)
	}
}
