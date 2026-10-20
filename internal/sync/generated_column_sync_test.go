package sync

import (
	"reflect"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestIsGeneratedColumnExtraMarkers(t *testing.T) {
	t.Parallel()
	for _, extra := range []string{"VIRTUAL GENERATED", "STORED GENERATED", "virtual generated", "  stored   generated  ", "GENERATED ALWAYS AS (...) STORED", "GENERATED", "MATERIALIZED", "ALIAS", "COMPUTED BY (x + y)"} {
		if !connection.IsGeneratedColumnExtra(extra) {
			t.Fatalf("IsGeneratedColumnExtra(%q) = false", extra)
		}
	}
	for _, extra := range []string{"", "auto_increment", "DEFAULT_GENERATED", "default_generated on update CURRENT_TIMESTAMP", "on update CURRENT_TIMESTAMP"} {
		if connection.IsGeneratedColumnExtra(extra) {
			t.Fatalf("IsGeneratedColumnExtra(%q) = true", extra)
		}
	}
}

func generatedColumnSyncConfig() SyncConfig {
	return SyncConfig{
		SourceConfig: connection.ConnectionConfig{Type: "mysql", Database: "source_db", Host: "source.local"},
		TargetConfig: connection.ConnectionConfig{Type: "mysql", Database: "target_db", Host: "target.local"},
		Tables:       []string{"crm_filing_offline"}, Content: "data", Mode: "insert_update",
		TargetTableStrategy: "existing_only",
		TableOptions:        map[string]TableOptions{"crm_filing_offline": {Insert: true, Update: true}},
	}
}

func TestRunSyncGeneratedColumnWrites(t *testing.T) {
	for _, path := range []string{"paged_diff", "direct_import", "composite_snapshot"} {
		for _, extra := range []string{"VIRTUAL GENERATED", "STORED GENERATED", ""} {
			t.Run(path+"/"+extra, func(t *testing.T) {
				composite := path == "composite_snapshot"
				source := newGeneratedColumnDB("source_db", "VIRTUAL GENERATED", composite)
				source.rows = generatedColumnRows(composite)
				target := newGeneratedColumnDB("target_db", extra, composite)
				target.rows = generatedColumnRows(composite)[:1]
				target.rows[0]["company"] = "旧公司"
				target.rows[0]["contract_company"] = "HT-1-旧公司"
				target.rows[0]["created_at"] = "2025-01-01 00:00:00"
				config := generatedColumnSyncConfig()
				wantInserts, wantUpdates := 1, 1
				if path == "direct_import" {
					config.Mode = "insert_only"
					wantInserts, wantUpdates = 2, 0
				}
				useSyncDatabaseFactorySequence(t, syncDatabaseFactoryStep{db: source}, syncDatabaseFactoryStep{db: target})
				result := NewSyncEngine(Reporter{}).RunSync(config)
				if !result.Success || result.RowsInserted != wantInserts || result.RowsUpdated != wantUpdates {
					t.Fatalf("RunSync() = %+v; rejected generated writes=%d", result, target.rejectedWrites)
				}
				assertGeneratedColumnChanges(t, target, extra, composite, wantInserts, wantUpdates)
				if len(source.queryLog) != 1 || strings.Contains(source.queryLog[0], "LIMIT") == composite {
					t.Fatalf("unexpected read path: %v", source.queryLog)
				}
				if path == "direct_import" && !strings.Contains(source.queryLog[0], "`contract_company`") {
					t.Fatalf("direct source read omitted generated value: %v", source.queryLog)
				}
				if len(target.execs) != 0 {
					t.Fatalf("existing generated column must not be added: %v", target.execs)
				}
			})
		}
	}
}

func assertGeneratedColumnChanges(t *testing.T, target *generatedColumnDB, extra string, composite bool, inserts, updates int) {
	t.Helper()
	changes := target.appliedChanges
	if len(changes.Inserts) != inserts || len(changes.Updates) != updates || target.rejectedWrites != 0 {
		t.Fatalf("changes = %+v, rejected = %d", changes, target.rejectedWrites)
	}
	for _, row := range changes.Inserts {
		_, hasGenerated := row["contract_company"]
		if hasGenerated != (extra == "") {
			t.Fatalf("wrong generated-column write policy: %#v", row)
		}
		if row["id"] == nil || row["company"] == nil || row["created_at"] == nil {
			t.Fatalf("lost ordinary/auto_increment/DEFAULT_GENERATED values: %#v", row)
		}
		if extra == "" && row["contract_company"] != row["contract_no"].(string)+"-"+row["company"].(string) {
			t.Fatalf("source-generated value not copied to ordinary target: %#v", row)
		}
	}
	for _, row := range changes.Updates {
		_, hasGenerated := row.Values["contract_company"]
		if hasGenerated != (extra == "") || row.Values["company"] != "甲公司" || row.Values["created_at"] != "2026-10-14 10:00:00" {
			t.Fatalf("wrong update values: %#v", row.Values)
		}
		wantKeys := map[string]interface{}{"id": int64(1)}
		if composite {
			wantKeys["filing_id"] = int64(9)
		}
		if !reflect.DeepEqual(row.Keys, wantKeys) {
			t.Fatalf("update keys = %#v, want %#v", row.Keys, wantKeys)
		}
	}
}

func TestRunSyncGeneratedOnlyDifferenceDoesNotUpdate(t *testing.T) {
	for _, composite := range []bool{false, true} {
		for _, extra := range []string{"VIRTUAL GENERATED", "STORED GENERATED"} {
			name := extra
			if composite {
				name += "/composite"
			}
			t.Run(name, func(t *testing.T) {
				source := newGeneratedColumnDB("source_db", extra, composite)
				target := newGeneratedColumnDB("target_db", extra, composite)
				source.rows = generatedColumnRows(composite)[:1]
				target.rows = generatedColumnRows(composite)[:1]
				target.rows[0]["contract_company"] = "different computed value"
				useSyncDatabaseFactorySequence(t, syncDatabaseFactoryStep{db: source}, syncDatabaseFactoryStep{db: target})
				result := NewSyncEngine(Reporter{}).RunSync(generatedColumnSyncConfig())
				if !result.Success || result.RowsInserted != 0 || result.RowsUpdated != 0 || len(target.appliedBatches) != 0 || target.rejectedWrites != 0 {
					t.Fatalf("generated-only difference wrote data: result=%+v batches=%+v rejected=%d", result, target.appliedBatches, target.rejectedWrites)
				}
			})
		}
	}
}

func TestBuildWritableTargetColumnSetExcludesGenerated(t *testing.T) {
	t.Parallel()
	cols := []connection.ColumnDefinition{
		{Name: "id", Extra: "auto_increment"}, {Name: "name"}, {Name: "created_at", Extra: "DEFAULT_GENERATED"},
		{Name: " full_name ", Extra: "VIRTUAL GENERATED"}, {Name: "snapshot_col", Extra: "MATERIALIZED"}, {Name: "expr_col", Extra: "STORED GENERATED"},
	}
	set := buildWritableTargetColumnSet(cols)
	if !reflect.DeepEqual(set, map[string]struct{}{"id": {}, "name": {}, "created_at": {}}) {
		t.Fatalf("writable set = %#v", set)
	}
	full := buildTargetColumnSet(cols)
	for _, name := range []string{"id", "name", "created_at", "full_name", "snapshot_col", "expr_col"} {
		if _, ok := full[name]; !ok {
			t.Fatalf("existence set missing %q: %#v", name, full)
		}
	}
}
