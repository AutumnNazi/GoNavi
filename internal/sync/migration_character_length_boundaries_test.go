package sync

import (
	"context"
	"errors"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

func TestMigrationCharacterParser(t *testing.T) {
	t.Parallel()
	cases := []struct {
		input, base, unit string
		length            int
		national, ok      bool
	}{
		{"VARCHAR2 ( 120   CHAR )", "varchar", "CHAR", 120, false, true},
		{"CHAR(8 byte)", "char", "BYTE", 8, false, true},
		{"character varying(16)", "varchar", "", 16, false, true},
		{"NVARCHAR2(12)", "varchar", "", 12, true, true},
		{"national character varying(9)", "varchar", "", 9, true, true},
		{"RAW(10)", "", "", 0, false, false},
		{"varchar(0)", "", "", 0, false, false},
		{"varchar(-1)", "", "", 0, false, false},
		{"varchar(999999999999999999999999)", "", "", 0, false, false},
		{"varchar(10); DROP TABLE t", "", "", 0, false, false},
	}
	for _, tc := range cases {
		t.Run(tc.input, func(t *testing.T) {
			got, ok := parseMigrationCharacterType(tc.input)
			if ok != tc.ok || got.base != tc.base || got.unit != tc.unit || got.length != tc.length || got.national != tc.national {
				t.Fatalf("got %+v %v, want %+v", got, ok, tc)
			}
		})
	}
}

func TestExistingCharacterCapacityCheck(t *testing.T) {
	t.Parallel()
	cases := []struct {
		source, target string
		warn           bool
	}{
		{"VARCHAR2(120 CHAR)", "varchar(120)", true},
		{"VARCHAR2(120 CHAR)", "varchar(120 CHAR)", false},
		{"VARCHAR2(120 CHAR)", "NVARCHAR2(120)", false},
		{"VARCHAR2(120 CHAR)", "NCHAR(120)", true},
		{"VARCHAR2(120 CHAR)", "varchar(119 CHAR)", true},
		{"VARCHAR2(120 CHAR)", "varchar(480 BYTE)", false},
		{"VARCHAR2(120 BYTE)", "varchar(120 BYTE)", true},
		{"VARCHAR2(120 BYTE)", "varchar(120 CHAR)", false},
		{"NVARCHAR2(120)", "varchar(120)", true},
		{"VARCHAR2(120 CHAR)", "text", false},
		{"NUMBER(12)", "varchar(12)", false},
	}
	for _, tc := range cases {
		t.Run(tc.source+"->"+tc.target, func(t *testing.T) {
			if got := characterLengthMayNarrow(tc.source, tc.target); got != tc.warn {
				t.Fatalf("warn=%v, want %v", got, tc.warn)
			}
		})
	}
}

func TestOracleCharacterPlanKeepsCancellation(t *testing.T) {
	t.Parallel()
	for _, cause := range []error{context.Canceled, context.DeadlineExceeded} {
		t.Run(cause.Error(), func(t *testing.T) {
			config := SyncConfig{SourceConfig: connection.ConnectionConfig{Type: "oracle"}, TargetConfig: connection.ConnectionConfig{Type: "vastbase"}}
			_, _, _, err := buildSchemaMigrationPlan(config, "T", &fakeMigrationDB{}, &characterLengthTargetDB{probeErr: cause})
			if !errors.Is(err, cause) {
				t.Fatalf("lost cancellation: %v", err)
			}
		})
	}
}

func TestOracleCharacterPlanUsesDictionarySemantics(t *testing.T) {
	t.Parallel()
	sourceType := db.FormatOracleColumnType(map[string]interface{}{"DATA_TYPE": "VARCHAR2", "CHAR_LENGTH": 40, "DATA_LENGTH": 160, "CHAR_USED": "C"})
	config := SyncConfig{SourceConfig: connection.ConnectionConfig{Type: "oracle"}, TargetConfig: connection.ConnectionConfig{Type: "vastbase"}, SourceDatabase: "SRC", TargetTableStrategy: "smart"}
	source := &fakeMigrationDB{columns: map[string][]connection.ColumnDefinition{"SRC.T": {{Name: "NOTE", Type: sourceType}}}}
	target := &characterLengthTargetDB{supported: true}
	plan, _, _, err := buildSchemaMigrationPlan(config, "T", source, target)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.ToLower(plan.CreateTableSQL), "varchar(40 char)") {
		t.Fatalf("dictionary-to-DDL lost character semantics: %s", plan.CreateTableSQL)
	}
	sql, _, err := buildAddColumnSQLForPair("oracle", "vastbase", "public.T", connection.ColumnDefinition{Name: "NOTE", Type: sourceType}, plan.characterLengthTarget)
	if err != nil || !strings.Contains(strings.ToLower(sql), "varchar(40 char)") {
		t.Fatalf("runtime ADD COLUMN lost planned capability: %s %v", sql, err)
	}
	if target.probes != 1 {
		t.Fatalf("unexpected repeated probe: %d", target.probes)
	}
}

func TestOracleCharacterPlanMappedExistingColumns(t *testing.T) {
	t.Parallel()
	source := &fakeMigrationDB{columns: map[string][]connection.ColumnDefinition{"SRC.T": {{Name: "NOTE", Type: "VARCHAR2(120 CHAR)"}}}}
	for _, rename := range []bool{false, true} {
		t.Run(map[bool]string{false: "object only", true: "column rename"}[rename], func(t *testing.T) {
			mapping := SyncObjectMapping{Source: SyncObjectRef{Schema: "SRC", Name: "T"}, Target: SyncObjectRef{Schema: "public", Name: "TARGET"}}
			targetName := "NOTE"
			if rename {
				targetName = "RENAMED"
				mapping.Columns = []SyncColumnMapping{{Source: "NOTE", Target: targetName}}
			}
			config := SyncConfig{SourceConfig: connection.ConnectionConfig{Type: "oracle"}, TargetConfig: connection.ConnectionConfig{Type: "vastbase"}, SourceDatabase: "SRC", TargetTableStrategy: "smart", Mappings: []SyncObjectMapping{mapping}}
			target := &characterLengthTargetDB{supported: true, fakeMigrationDB: fakeMigrationDB{columns: map[string][]connection.ColumnDefinition{"public.TARGET": {{Name: targetName, Type: "varchar(120)"}}}}}
			plan, _, _, err := buildSchemaMigrationPlan(config, "SRC.T", source, target)
			if err != nil {
				t.Fatal(err)
			}
			warning := localizedSyncBackendText("data_sync.backend.hint.character_length_existing", map[string]any{"column": targetName, "source_type": "VARCHAR2(120 CHAR)", "target_type": "varchar(120)"})
			if strings.Count(strings.Join(plan.Warnings, " "), warning) != 1 {
				t.Fatalf("missing or duplicate mapped warning: %v", plan.Warnings)
			}
			if len(plan.PreDataSQL) != 0 || plan.AutoCreate {
				t.Fatalf("must not alter mapped existing columns: %+v", plan)
			}
			if target.probes != 1 {
				t.Fatalf("recursive planning probed %d times", target.probes)
			}
		})
	}
}

func TestSuggestedCharacterAlterKeepsTypeAndUnit(t *testing.T) {
	t.Parallel()
	cases := []struct {
		typ, unit, want string
		chars           int
	}{
		{"char(2 CHAR)", "CHAR", "char(3 CHAR)", 3},
		{"varchar(2 BYTE)", "BYTE", "varchar(8 BYTE)", 2},
		{"NVARCHAR2(2)", "CHAR", "nvarchar2(3)", 3},
		{"NCHAR(2)", "", "nchar(8)", 2},
		{"character varying(2)", "", "varchar(8)", 2},
	}
	for _, tc := range cases {
		t.Run(tc.typ, func(t *testing.T) {
			sql := suggestedCharacterColumnAlter("vastbase", "public.T", valueLengthFinding{Column: "NOTE", Type: tc.typ, Limit: 2, MaxChars: tc.chars, MaxBytes: 6, Unit: tc.unit})
			if !strings.Contains(sql, tc.want) {
				t.Fatalf("suggestion %s lacks %s", sql, tc.want)
			}
		})
	}
}
