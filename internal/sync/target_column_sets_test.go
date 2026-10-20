package sync

import (
	"reflect"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestTargetColumnSetsUnknownAndGeneratedOnlyMetadata(t *testing.T) {
	t.Parallel()
	for _, cols := range [][]connection.ColumnDefinition{nil, {}} {
		if buildTargetColumnSet(cols) != nil || buildWritableTargetColumnSet(cols) != nil {
			t.Fatalf("unavailable metadata must remain unknown: %#v", cols)
		}
	}
	cols := []connection.ColumnDefinition{{Name: " Contract_Company ", Extra: "STORED GENERATED"}}
	writable := buildWritableTargetColumnSet(cols)
	if writable == nil || len(writable) != 0 {
		t.Fatalf("known generated-only metadata must yield a non-nil empty set: %#v", writable)
	}
	if got := buildTargetColumnSet(cols); !reflect.DeepEqual(got, map[string]struct{}{"contract_company": {}}) {
		t.Fatalf("existence set = %#v", got)
	}
}

func TestMissingChangeSetColumnsUsesExistenceAndUnfilteredValues(t *testing.T) {
	t.Parallel()
	changes := connection.ChangeSet{
		Inserts: []map[string]interface{}{{"contract_company": "computed", " Z_new ": "insert value"}},
		Updates: []connection.UpdateRow{{Keys: map[string]interface{}{"key_only": 1}, Values: map[string]interface{}{"a_new": "update value", "CONTRACT_COMPANY": "computed"}}},
	}
	cols := []connection.ColumnDefinition{{Name: "contract_company", Extra: "VIRTUAL GENERATED"}}
	if got := missingChangeSetColumns(changes, cols); !reflect.DeepEqual(got, []string{" Z_new ", "a_new"}) {
		t.Fatalf("missing columns = %#v; generated target exists, keys are not write values", got)
	}
	if len(changes.Inserts[0]) != 2 || len(changes.Updates[0].Values) != 2 {
		t.Fatal("missing-column detection modified the changeset before ALTER")
	}
}

func TestQuerySourceColumnFilterDistinguishesUnknownFromGeneratedOnly(t *testing.T) {
	t.Parallel()
	changes := connection.ChangeSet{
		Inserts: []map[string]interface{}{{"contract_company": "computed"}},
		Updates: []connection.UpdateRow{{Keys: map[string]interface{}{"id": 1}, Values: map[string]interface{}{"contract_company": "computed"}}},
		Deletes: []map[string]interface{}{{"id": 2}},
	}
	unknown := applyQuerySourceColumnFilter(changes, nil)
	if !reflect.DeepEqual(unknown, changes) {
		t.Fatalf("unknown metadata changed data: %+v", unknown)
	}
	filtered := applyQuerySourceColumnFilter(changes, []connection.ColumnDefinition{{Name: "contract_company", Extra: "VIRTUAL GENERATED"}})
	if len(filtered.Inserts) != 1 || len(filtered.Inserts[0]) != 0 || len(filtered.Updates) != 0 || !reflect.DeepEqual(filtered.Deletes, changes.Deletes) {
		t.Fatalf("known generated-only metadata leaked writes or changed deletes: %+v", filtered)
	}
}
