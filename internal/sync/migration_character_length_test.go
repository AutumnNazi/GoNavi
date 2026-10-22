package sync

import (
	"context"
	"errors"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

type characterLengthTargetDB struct {
	fakeMigrationDB
	supported bool
	probeErr  error
	probes    int
}

func (f *characterLengthTargetDB) Query(query string) ([]map[string]interface{}, []string, error) {
	if !strings.Contains(query, "gonavi_varchar_char") {
		return f.fakeMigrationDB.Query(query)
	}
	f.probes++
	if f.probeErr != nil {
		return nil, nil, f.probeErr
	}
	if !f.supported {
		return nil, nil, nil
	}
	return []map[string]interface{}{{
		"gonavi_varchar_char": "中文", "gonavi_char_char": "中文",
		"gonavi_varchar_byte": "ab", "gonavi_char_byte": "ab",
	}}, nil, nil
}

func (f *characterLengthTargetDB) QueryContext(ctx context.Context, query string) ([]map[string]interface{}, []string, error) {
	return f.Query(query)
}

func TestOracleQualifiedCharacterMigrationPlan(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, source, target, want string
		supported                  bool
		probeErr                   error
	}{
		{name: "explicit character", source: "VARCHAR2(120 CHAR)", target: "vastbase", want: "varchar(120 CHAR)", supported: true},
		{name: "fixed character", source: "CHAR(8 CHAR)", target: "vastbase", want: "char(8 CHAR)", supported: true},
		{name: "national variable", source: "NVARCHAR2(20)", target: "opengauss", want: "varchar(20 CHAR)", supported: true},
		{name: "national fixed", source: "NCHAR(8)", target: "gaussdb", want: "char(8 CHAR)", supported: true},
		{name: "byte unknown encoding", source: "VARCHAR2(120 BYTE)", target: "vastbase", want: "varchar(480 BYTE)", supported: true},
		{name: "legacy character fallback", source: "VARCHAR2(120 CHAR)", target: "vastbase", want: "varchar(480)"},
		{name: "legacy fixed fallback", source: "CHAR(8 CHAR)", target: "vastbase", want: "char(32)"},
		{name: "probe failure fallback", source: "VARCHAR2(120 CHAR)", target: "vastbase", want: "varchar(480)", probeErr: errors.New("unsupported syntax")},
		{name: "whitespace qualifier", source: "VARCHAR2 ( 120   CHAR )", target: "vastbase", want: "varchar(120 CHAR)", supported: true},
		{name: "postgres no qualifier", source: "CHAR(8 CHAR)", target: "postgres", want: "char(8)"},
		{name: "mysql no qualifier", source: "CHAR(8 BYTE)", target: "mysql", want: "char(8)"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			config := SyncConfig{SourceConfig: connection.ConnectionConfig{Type: "oracle"}, TargetConfig: connection.ConnectionConfig{Type: tc.target}, SourceDatabase: "SRC", TargetDatabase: "DST", TargetTableStrategy: "smart"}
			source := &fakeMigrationDB{columns: map[string][]connection.ColumnDefinition{"SRC.T": {{Name: "VALUE", Type: tc.source, Nullable: "YES"}}}}
			target := &characterLengthTargetDB{supported: tc.supported, probeErr: tc.probeErr}
			plan, _, _, err := buildSchemaMigrationPlan(config, "T", source, target)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(strings.ToLower(plan.CreateTableSQL), strings.ToLower(tc.want)) {
				t.Fatalf("want %s in DDL, got %s; warnings %v", tc.want, plan.CreateTableSQL, plan.Warnings)
			}
			if tc.supported && strings.HasSuffix(tc.want, " CHAR)") && strings.Contains(strings.Join(plan.Warnings, " "), "放宽") {
				t.Fatalf("character semantics must not widen: %v", plan.Warnings)
			}
			if tc.target == "mysql" || tc.target == "postgres" {
				if target.probes != 0 {
					t.Fatalf("unexpected probe for %s", tc.target)
				}
			} else if target.probes != 1 {
				t.Fatalf("expected one target capability probe, got %d", target.probes)
			}
		})
	}
}

func TestOracleQualifiedCharacterAddColumnPlan(t *testing.T) {
	t.Parallel()
	config := SyncConfig{SourceConfig: connection.ConnectionConfig{Type: "oracle"}, TargetConfig: connection.ConnectionConfig{Type: "vastbase"}, SourceDatabase: "SRC", TargetDatabase: "DST", TargetTableStrategy: "smart", AutoAddColumns: true}
	source := &fakeMigrationDB{columns: map[string][]connection.ColumnDefinition{"SRC.T": {{Name: "ID", Type: "NUMBER(10)"}, {Name: "NOTE", Type: "VARCHAR2(40 CHAR)"}}}}
	target := &characterLengthTargetDB{supported: true, fakeMigrationDB: fakeMigrationDB{columns: map[string][]connection.ColumnDefinition{"public.T": {{Name: "ID", Type: "integer"}}}}}
	plan, _, _, err := buildSchemaMigrationPlan(config, "T", source, target)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.PreDataSQL) != 1 || !strings.Contains(strings.ToLower(plan.PreDataSQL[0]), "varchar(40 char)") {
		t.Fatalf("unexpected ADD COLUMN: %v", plan.PreDataSQL)
	}
	if strings.Contains(strings.Join(plan.PreDataSQL, " "), "ALTER COLUMN") {
		t.Fatal("must not alter existing columns")
	}
}

func TestOracleExistingCharacterColumnWarnsWithoutAltering(t *testing.T) {
	t.Parallel()
	config := SyncConfig{SourceConfig: connection.ConnectionConfig{Type: "oracle"}, TargetConfig: connection.ConnectionConfig{Type: "vastbase"}, SourceDatabase: "SRC", TargetDatabase: "DST", TargetTableStrategy: "smart"}
	source := &fakeMigrationDB{columns: map[string][]connection.ColumnDefinition{"SRC.T": {{Name: "NOTE", Type: "VARCHAR2(120 CHAR)"}}}}
	target := &characterLengthTargetDB{supported: true, fakeMigrationDB: fakeMigrationDB{columns: map[string][]connection.ColumnDefinition{"public.T": {{Name: "NOTE", Type: "varchar(120)"}}}}}
	plan, _, _, err := buildSchemaMigrationPlan(config, "T", source, target)
	if err != nil {
		t.Fatal(err)
	}
	if plan.AutoCreate || plan.CreateTableSQL != "" || len(plan.PreDataSQL) != 0 {
		t.Fatalf("must not change existing schema: %+v", plan)
	}
	if plan.PlannedAction == "表结构已一致" {
		t.Fatal("matching column names do not imply matching length semantics")
	}
	if !strings.Contains(strings.Join(plan.Warnings, " "), "NOTE") {
		t.Fatalf("missing column-specific length warning: %v", plan.Warnings)
	}
}
