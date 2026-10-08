package mockdata

import (
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
)

var suggestNow = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

func TestSuggestPlansByNameAndType(t *testing.T) {
	columns := []connection.ColumnDefinition{
		{Name: "id", Type: "bigint", Nullable: "NO", Extra: "auto_increment", Key: "PRI"},
		{Name: "user_name", Type: "varchar(32)", Nullable: "NO"},
		{Name: "real_name", Type: "varchar(32)", Nullable: "YES"},
		{Name: "file_name", Type: "varchar(64)", Nullable: "YES"},
		{Name: "email", Type: "varchar(64)", Nullable: "YES"},
		{Name: "mobile", Type: "varchar(20)", Nullable: "YES"},
		{Name: "age", Type: "tinyint(4)", Nullable: "YES"},
		{Name: "level", Type: "tinyint(3) unsigned", Nullable: "YES"},
		{Name: "price", Type: "decimal(6,2)", Nullable: "YES"},
		{Name: "is_deleted", Type: "tinyint(1)", Nullable: "NO", HasDefault: true},
		{Name: "created_at", Type: "timestamp", Nullable: "YES"},
		{Name: "owner_id", Type: "int", Nullable: "NO"},
		{Name: "shape", Type: "geometry", Nullable: "YES"},
		{Name: "full_total", Type: "int", Nullable: "YES", Extra: "STORED GENERATED"},
	}
	keys := TableKeys{ForeignKeys: map[string]ForeignKey{"owner_id": {Table: "users", Column: "id"}}}
	plans := SuggestPlans(ClassifyTable(FamilyMySQL, columns, keys), LocaleZH, suggestNow)
	byName := map[string]ColumnPlan{}
	for _, plan := range plans {
		byName[plan.Name] = plan
	}
	expectKind := func(name string, kind Kind) ColumnPlan {
		t.Helper()
		plan := byName[name]
		if plan.Generator.Kind != kind {
			t.Fatalf("%s: kind = %s, want %s", name, plan.Generator.Kind, kind)
		}
		return plan
	}
	if !byName["id"].Skip || !byName["full_total"].Skip || !byName["shape"].Skip {
		t.Fatal("auto-increment, computed and unsupported nullable columns should be skipped")
	}
	expectKind("user_name", KindUsername)
	if plan := expectKind("real_name", KindPersonName); plan.Generator.Locale != LocaleZH {
		t.Fatalf("real_name locale = %s", plan.Generator.Locale)
	}
	expectKind("file_name", KindText)
	expectKind("email", KindEmail)
	expectKind("mobile", KindPhone)
	if plan := expectKind("age", KindIntRange); plan.Generator.Min != "18" || plan.Generator.Max != "65" {
		t.Fatalf("age range = %+v", plan.Generator)
	}
	if plan := expectKind("level", KindIntRange); plan.Generator.Max != "5" {
		t.Fatalf("level range = %+v", plan.Generator)
	}
	if plan := expectKind("price", KindDecimalRange); plan.Generator.Max != "9999.99" || plan.Generator.Scale != 2 {
		t.Fatalf("price should be clamped to decimal(6,2): %+v", plan.Generator)
	}
	expectKind("is_deleted", KindBoolean)
	expectKind("created_at", KindDateTimeRange)
	expectKind("owner_id", KindReference)

	refs := References{"owner_id": {"1"}}
	plan := Plan{RowCount: 25, Seed: 11, Locale: LocaleZH, Columns: plans}
	producer, err := NewProducer(plan, ClassifyTable(FamilyMySQL, columns, keys), refs)
	if err != nil {
		t.Fatalf("suggested plan should compile: %v", err)
	}
	if got := len(collect(t, producer)); got != 25 {
		t.Fatalf("rows = %d", got)
	}
}

func TestSuggestRespectsColumnLimits(t *testing.T) {
	columns := []connection.ColumnDefinition{
		{Name: "id", Type: "int", Nullable: "NO", Key: "PRI"},
		{Name: "name", Type: "varchar(50)", Nullable: "YES"},
		{Name: "code", Type: "char(2)", Nullable: "YES"},
		{Name: "ts", Type: "TIMESTAMP", Nullable: "NO"},
	}
	cases := []struct {
		dialect string
		check   func(t *testing.T, plans map[string]ColumnPlan)
	}{
		{"sqlserver", func(t *testing.T, plans map[string]ColumnPlan) {
			if plans["name"].Generator.Locale != LocaleEN {
				t.Fatalf("varchar on SQL Server should fall back to English: %+v", plans["name"].Generator)
			}
		}},
		{"mysql", func(t *testing.T, plans map[string]ColumnPlan) {
			if plans["id"].Generator.Kind != KindSequence || plans["id"].Generator.Start != "1" {
				t.Fatalf("non-auto primary key should use a sequence: %+v", plans["id"].Generator)
			}
			if plans["code"].Generator.MaxLength != 2 {
				t.Fatalf("char(2) should cap length: %+v", plans["code"].Generator)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.dialect, func(t *testing.T) {
			profiles := ClassifyTable(ResolveFamily(tc.dialect), columns, TableKeys{})
			byName := map[string]ColumnPlan{}
			for _, plan := range SuggestPlans(profiles, LocaleZH, suggestNow) {
				byName[plan.Name] = plan
			}
			tc.check(t, byName)
			if _, err := NewProducer(Plan{RowCount: 10, Seed: 2, Locale: LocaleZH, Columns: SuggestPlans(profiles, LocaleZH, suggestNow)}, profiles, nil); err != nil {
				t.Fatalf("suggested plan should compile: %v", err)
			}
		})
	}
}

func TestSuggestUsesNextValueForKeys(t *testing.T) {
	profiles := ClassifyTable(FamilyOracle, []connection.ColumnDefinition{
		{Name: "ID", Type: "NUMBER(10)", Nullable: "N"},
	}, TableKeys{PrimaryKey: []string{"ID"}})
	if !NeedsNextValue(profiles[0]) {
		t.Fatal("integer primary key without identity needs MAX+1")
	}
	profiles[0].SetNextValue("501")
	plans := SuggestPlans(profiles, LocaleEN, suggestNow)
	if plans[0].Generator.Kind != KindSequence || plans[0].Generator.Start != "501" {
		t.Fatalf("plan = %+v", plans[0].Generator)
	}
}

func TestSuggestOracleByteLengthColumns(t *testing.T) {
	profiles := ClassifyTable(FamilyOracle, []connection.ColumnDefinition{
		{Name: "ENAME", Type: "VARCHAR2(10)", Nullable: "Y"},
		{Name: "FILENAME", Type: "VARCHAR2(40)", Nullable: "Y"},
		{Name: "GRADE", Type: "VARCHAR2(3)", Nullable: "Y"},
	}, TableKeys{})
	plans := SuggestPlans(profiles, LocaleZH, suggestNow)
	if plans[0].Generator.Kind != KindPersonName {
		t.Fatalf("ENAME should be a person name: %+v", plans[0].Generator)
	}
	if plans[1].Generator.Kind != KindText {
		t.Fatalf("FILENAME is an object name, not a person: %+v", plans[1].Generator)
	}
	if gen := plans[2].Generator; gen.Kind != KindRandomString || gen.MaxLength != 3 {
		t.Fatalf("ASCII rules should count one byte per letter: %+v", gen)
	}
	producer, err := NewProducer(Plan{RowCount: 50, Seed: 3, Locale: LocaleZH, Columns: plans}, profiles, nil)
	if err != nil {
		t.Fatalf("suggested plan should compile: %v", err)
	}
	for _, row := range collect(t, producer) {
		if name := row["ENAME"].(string); len(name) > 10 {
			t.Fatalf("ENAME %q exceeds 10 bytes", name)
		}
	}
}

func TestNameTokens(t *testing.T) {
	tokens := nameTokens("userEmail_Address")
	for _, word := range []string{"user", "email", "address"} {
		if !tokens.any(word) {
			t.Fatalf("missing token %s in %v", word, tokens)
		}
	}
	if nameTokens("domain").any("ip") {
		t.Fatal("tokens must not match substrings")
	}
}

func TestSampleQueries(t *testing.T) {
	cases := []struct {
		family Family
		want   string
	}{
		{FamilyMySQL, "SELECT DISTINCT `c` FROM `t` WHERE `c` IS NOT NULL LIMIT 5"},
		{FamilySQLServer, "SELECT DISTINCT TOP 5 `c` FROM `t` WHERE `c` IS NOT NULL"},
		{FamilyOracle, "SELECT `c` FROM (SELECT DISTINCT `c` FROM `t` WHERE `c` IS NOT NULL) WHERE ROWNUM <= 5"},
		{FamilyFirebird, "SELECT FIRST 5 DISTINCT `c` FROM `t` WHERE `c` IS NOT NULL"},
	}
	for _, tc := range cases {
		if got := DistinctSampleQuery(tc.family, "`t`", "`c`", 5); got != tc.want {
			t.Fatalf("%s: %s", tc.family, got)
		}
	}
	if got := PostgresEnumLabelsQuery(`public."mo'od"`); got != "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'mo''od' ORDER BY e.enumsortorder" {
		t.Fatalf("enum query = %s", got)
	}
}
