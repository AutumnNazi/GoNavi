package sync

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestPrepareGeneratedColumnWritableSet(t *testing.T) {
	cases := []struct {
		name    string
		missing bool
		autoAdd bool
		failAdd bool
	}{
		{name: "no_missing"},
		{name: "missing_not_added", missing: true},
		{name: "missing_added", missing: true, autoAdd: true},
		{name: "add_failure", missing: true, autoAdd: true, failAdd: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			target := newGeneratedColumnDB("target_db", "STORED GENERATED", false)
			sourceCols := generatedColumnColumns("VIRTUAL GENERATED", false)
			if tc.missing {
				// An added source-generated column is materialized as an ordinary target column.
				sourceCols = append(sourceCols, connection.ColumnDefinition{Name: "late_value", Type: "varchar(64)", Extra: "VIRTUAL GENERATED"})
			}
			if tc.failAdd {
				target.execErr = errors.New("alter rejected")
			}
			config := generatedColumnSyncConfig()
			config.Content, config.AutoAddColumns = "both", tc.autoAdd
			plan := SchemaMigrationPlan{TargetSchema: "target_db", TargetTable: "crm_filing_offline", TargetQueryTable: "target_db.crm_filing_offline"}
			set, err := NewSyncEngine(Reporter{}).prepareDirectImportTargetColumnSet(config, &SyncResult{}, target, plan, "mysql", "mysql", sourceCols, nil)
			if tc.failAdd {
				if err == nil || set != nil {
					t.Fatalf("failed ALTER returned writable set: %#v, %v", set, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			want := map[string]struct{}{"id": {}, "contract_no": {}, "company": {}, "created_at": {}}
			if tc.autoAdd && tc.missing {
				want["late_value"] = struct{}{}
			}
			if !reflect.DeepEqual(set, want) {
				t.Fatalf("writable set = %#v, want %#v", set, want)
			}
			wantExecs := 0
			if tc.autoAdd && tc.missing {
				wantExecs = 1
			}
			if len(target.execs) != wantExecs || (wantExecs == 1 && strings.Contains(target.execs[0], "GENERATED")) {
				t.Fatalf("unexpected ALTERs: %v", target.execs)
			}
		})
	}
}

func TestRunSyncGeneratedSnapshotLateColumnPreservesValues(t *testing.T) {
	for _, operation := range []string{"insert", "update_only_new_column"} {
		t.Run(operation, func(t *testing.T) {
			source := newGeneratedColumnDB("source_db", "VIRTUAL GENERATED", true)
			target := newGeneratedColumnDB("target_db", "VIRTUAL GENERATED", true)
			late := connection.ColumnDefinition{Name: "late_value", Type: "varchar(64)", Nullable: "YES"}
			preflight := connection.ColumnDefinition{Name: "preflight", Type: "varchar(64)", Nullable: "YES"}
			source.columns["source_db.crm_filing_offline"] = append(source.columns["source_db.crm_filing_offline"], late, preflight)
			target.columns["target_db.crm_filing_offline"] = append(target.columns["target_db.crm_filing_offline"], late)
			target.dropOnSchemaAdd = true
			source.rows = generatedColumnRows(true)[:1]
			source.rows[0]["late_value"] = "must survive post-read ALTER"
			if operation == "update_only_new_column" {
				target.rows = generatedColumnRows(true)[:1]
			}
			config := generatedColumnSyncConfig()
			config.Content, config.AutoAddColumns = "both", true
			useSyncDatabaseFactorySequence(t, syncDatabaseFactoryStep{db: source}, syncDatabaseFactoryStep{db: target})
			result := NewSyncEngine(Reporter{}).RunSync(config)
			if !result.Success {
				t.Fatalf("RunSync() = %+v", result)
			}
			// Prove late_value was added AFTER the snapshot read, not by the pre-data planner.
			if !reflect.DeepEqual(target.events, []string{"add:preflight", "query", "add:late_value", "apply"}) {
				t.Fatalf("snapshot alignment order = %v", target.events)
			}
			var values map[string]interface{}
			if operation == "insert" {
				if result.RowsInserted != 1 || len(target.appliedChanges.Inserts) != 1 {
					t.Fatalf("insert lost: %+v", result)
				}
				values = target.appliedChanges.Inserts[0]
			} else {
				if result.RowsUpdated != 1 || len(target.appliedChanges.Updates) != 1 {
					t.Fatalf("new-column-only update lost: %+v", result)
				}
				update := target.appliedChanges.Updates[0]
				values = update.Values
				if len(values) != 1 || !reflect.DeepEqual(update.Keys, map[string]interface{}{"id": int64(1), "filing_id": int64(9)}) {
					t.Fatalf("expected only late_value and complete composite key: %+v", update)
				}
			}
			if values["late_value"] != "must survive post-read ALTER" {
				t.Fatalf("new column value discarded: %#v", values)
			}
			if _, ok := values["contract_company"]; ok {
				t.Fatalf("generated column leaked: %#v", values)
			}
		})
	}
}

func TestGeneratedColumnFilterNilAndEmptySets(t *testing.T) {
	for _, tc := range []struct {
		name string
		set  map[string]struct{}
		keep bool
	}{
		{name: "unknown_metadata", set: nil, keep: true},
		{name: "known_no_writable_columns", set: map[string]struct{}{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			inserts := []map[string]interface{}{{"contract_company": "computed"}}
			updates := []connection.UpdateRow{{Keys: map[string]interface{}{"id": 1}, Values: inserts[0]}}
			gotInserts := filterInsertRows(inserts, tc.set)
			gotUpdates := filterUpdateRows(updates, tc.set)
			if tc.keep {
				if !reflect.DeepEqual(gotInserts, inserts) || !reflect.DeepEqual(gotUpdates, updates) {
					t.Fatalf("nil must preserve unknown-metadata compatibility: %v %v", gotInserts, gotUpdates)
				}
			} else if len(gotInserts) != 1 || len(gotInserts[0]) != 0 || len(gotUpdates) != 0 {
				t.Fatalf("empty allowlist leaked values: %v %v", gotInserts, gotUpdates)
			}
			cols := []connection.ColumnDefinition{{Name: "id"}, {Name: "contract_company"}}
			want := cols[:1]
			if tc.keep {
				want = cols
			}
			if got := diffReadableColumns(cols, tc.set, "id"); !reflect.DeepEqual(got, want) {
				t.Errorf("read columns = %v, want %v", got, want)
			}
			if got := diffLookupColumns(cols, cols, tc.set, "id"); !reflect.DeepEqual(got, want) {
				t.Errorf("lookup columns = %v, want %v", got, want)
			}
		})
	}
}

func TestGeneratedColumnEmptyAllowlistDirectPage(t *testing.T) {
	target := newGeneratedColumnDB("target_db", "STORED GENERATED", false)
	rows := []map[string]interface{}{{"contract_company": "computed"}}
	inserted, err := NewSyncEngine(Reporter{}).applyDirectImportPage(generatedColumnSyncConfig(), &SyncResult{}, "crm_filing_offline", "crm_filing_offline", target, map[string]struct{}{}, "", TableOptions{Insert: true}, rows, 1000, 0)
	if err != nil || inserted != 1 || len(target.appliedChanges.Inserts) != 1 || len(target.appliedChanges.Inserts[0]) != 0 {
		t.Fatalf("empty allowlist must filter every write column: inserted=%d err=%v changes=%+v", inserted, err, target.appliedChanges)
	}
}
