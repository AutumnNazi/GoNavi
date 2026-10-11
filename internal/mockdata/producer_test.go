package mockdata

import (
	"errors"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"GoNavi-Wails/internal/connection"
)

func profilesFor(t *testing.T, dialect string, columns ...connection.ColumnDefinition) []Profile {
	t.Helper()
	return ClassifyTable(ResolveFamily(dialect), columns, TableKeys{})
}

func collect(t *testing.T, producer *Producer) []map[string]interface{} {
	t.Helper()
	var rows []map[string]interface{}
	for {
		row, ok, err := producer.Next()
		if err != nil {
			t.Fatalf("Next: %v", err)
		}
		if !ok {
			return rows
		}
		rows = append(rows, row)
	}
}

func expectPlanError(t *testing.T, err error, code string) {
	t.Helper()
	var planErr *PlanError
	if !errors.As(err, &planErr) || planErr.Code != code {
		t.Fatalf("error = %v, want code %s", err, code)
	}
}

func TestProducerIsDeterministicAndPreviewMatchesRun(t *testing.T) {
	profiles := profilesFor(t, "mysql",
		connection.ColumnDefinition{Name: "id", Type: "int", Nullable: "NO", Key: "PRI"},
		connection.ColumnDefinition{Name: "name", Type: "varchar(20)", Nullable: "YES"},
		connection.ColumnDefinition{Name: "amount", Type: "decimal(8,2)", Nullable: "YES"},
	)
	plan := Plan{RowCount: 50, Seed: 42, Locale: LocaleZH, Columns: []ColumnPlan{
		{Name: "id", Generator: Generator{Kind: KindSequence, Start: "100", Step: "2"}},
		{Name: "name", Generator: Generator{Kind: KindPersonName}},
		{Name: "amount", Generator: Generator{Kind: KindDecimalRange, Min: "1", Max: "99.5", Scale: 2}},
	}}
	full := mustProducer(t, plan, profiles)
	rows := collect(t, full)
	preview := plan
	preview.RowCount = PreviewRowCount
	previewRows := collect(t, mustProducer(t, preview, profiles))
	for i := range previewRows {
		for key, value := range previewRows[i] {
			if rows[i][key] != value {
				t.Fatalf("row %d column %s: preview %v, run %v", i, key, value, rows[i][key])
			}
		}
	}
	if rows[0]["id"] != "100" || rows[49]["id"] != "198" {
		t.Fatalf("sequence = %v .. %v", rows[0]["id"], rows[49]["id"])
	}
	for _, row := range rows {
		amount, err := strconv.ParseFloat(row["amount"].(string), 64)
		if err != nil || amount < 1 || amount > 99.5 {
			t.Fatalf("amount out of range: %v", row["amount"])
		}
	}
}

func mustProducer(t *testing.T, plan Plan, profiles []Profile) *Producer {
	t.Helper()
	producer, err := NewProducer(plan, profiles, nil)
	if err != nil {
		t.Fatalf("NewProducer: %v", err)
	}
	return producer
}

func TestProducerValidation(t *testing.T) {
	profiles := profilesFor(t, "mysql",
		connection.ColumnDefinition{Name: "id", Type: "tinyint(4)", Nullable: "NO"},
		connection.ColumnDefinition{Name: "flag", Type: "tinyint(1)", Nullable: "YES"},
		connection.ColumnDefinition{Name: "created", Type: "timestamp", Nullable: "YES"},
		connection.ColumnDefinition{Name: "total", Type: "int", Nullable: "YES", Extra: "VIRTUAL GENERATED"},
		connection.ColumnDefinition{Name: "status", Type: "enum('a','b')", Nullable: "YES"},
	)
	base := func(columns ...ColumnPlan) Plan {
		return Plan{RowCount: 10, Seed: 1, Columns: append([]ColumnPlan{
			{Name: "id", Generator: Generator{Kind: KindIntRange, Min: "1", Max: "100"}},
		}, columns...)}
	}
	cases := []struct {
		name string
		plan Plan
		code string
	}{
		{"row count", Plan{RowCount: 0}, ErrCodeRowCount},
		{"unknown column", base(ColumnPlan{Name: "nope"}), ErrCodeUnknownColumn},
		{"required skipped", Plan{RowCount: 1, Columns: []ColumnPlan{{Name: "id", Skip: true}}}, ErrCodeRequiredSkipped},
		{"tinyint out of range", Plan{RowCount: 1, Columns: []ColumnPlan{{Name: "id", Generator: Generator{Kind: KindIntRange, Min: "1", Max: "300"}}}}, ErrCodeOutOfTypeRange},
		{"timestamp after 2038", base(ColumnPlan{Name: "created", Generator: Generator{Kind: KindDateTimeRange, Min: "2030-01-01 00:00:00", Max: "2040-01-01 00:00:00"}}), ErrCodeOutOfTypeRange},
		{"computed column", base(ColumnPlan{Name: "total", Generator: Generator{Kind: KindIntRange, Min: "1", Max: "2"}}), ErrCodeComputedColumn},
		{"kind not allowed", base(ColumnPlan{Name: "flag", Generator: Generator{Kind: KindEmail}}), ErrCodeKindNotAllowed},
		{"enum value not in enum", base(ColumnPlan{Name: "status", Generator: Generator{Kind: KindEnum, Values: []string{"z"}}}), ErrCodeValueNotInEnum},
		{"null on not null", Plan{RowCount: 1, Columns: []ColumnPlan{{Name: "id", Generator: Generator{Kind: KindNull}}}}, ErrCodeNullNotAllowed},
		{"null ratio on not null", Plan{RowCount: 1, Columns: []ColumnPlan{{Name: "id", NullRatio: 0.5, Generator: Generator{Kind: KindIntRange, Min: "1", Max: "2"}}}}, ErrCodeNullNotAllowed},
		{"inverted range", Plan{RowCount: 1, Columns: []ColumnPlan{{Name: "id", Generator: Generator{Kind: KindIntRange, Min: "9", Max: "1"}}}}, ErrCodeInvalidRange},
		{"sequence step zero", Plan{RowCount: 1, Columns: []ColumnPlan{{Name: "id", Generator: Generator{Kind: KindSequence, Step: "0"}}}}, ErrCodeSequenceStepZero},
		{"sequence overflows tinyint", Plan{RowCount: 200, Columns: []ColumnPlan{{Name: "id", Generator: Generator{Kind: KindSequence, Start: "1"}}}}, ErrCodeOutOfTypeRange},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewProducer(tc.plan, profiles, nil)
			expectPlanError(t, err, tc.code)
		})
	}
}

func TestProducerUniqueColumns(t *testing.T) {
	columns := []connection.ColumnDefinition{
		{Name: "code", Type: "int", Nullable: "NO"},
		{Name: "email", Type: "varchar(30)", Nullable: "NO"},
		{Name: "status", Type: "enum('a','b','c')", Nullable: "NO"},
		{Name: "owner_id", Type: "int", Nullable: "NO"},
	}
	keys := TableKeys{
		Unique:      [][]string{{"code"}, {"email"}, {"status"}, {"owner_id"}},
		ForeignKeys: map[string]ForeignKey{"owner_id": {Table: "users", Column: "id"}},
	}
	profiles := ClassifyTable(FamilyMySQL, columns, keys)
	refs := References{"owner_id": {"1", "2", "3"}}
	plan := Plan{RowCount: 3, Seed: 7, Columns: []ColumnPlan{
		{Name: "code", Generator: Generator{Kind: KindIntRange, Min: "1", Max: "3"}},
		{Name: "email", Generator: Generator{Kind: KindEmail}},
		{Name: "status", Generator: Generator{Kind: KindEnum}},
		{Name: "owner_id", Generator: Generator{Kind: KindReference}},
	}}
	producer, err := NewProducer(plan, profiles, refs)
	if err != nil {
		t.Fatalf("NewProducer: %v", err)
	}
	rows := collect(t, producer)
	for _, column := range []string{"code", "email", "status", "owner_id"} {
		seen := map[interface{}]bool{}
		for _, row := range rows {
			if seen[row[column]] {
				t.Fatalf("column %s repeated value %v", column, row[column])
			}
			seen[row[column]] = true
			if column == "email" && utf8.RuneCountInString(row[column].(string)) > 30 {
				t.Fatalf("email too long: %v", row[column])
			}
		}
	}

	plan.RowCount = 4
	_, err = NewProducer(plan, profiles, refs)
	expectPlanError(t, err, ErrCodeUniqueDomain)
}

func TestProducerReferenceAndNullRatio(t *testing.T) {
	columns := []connection.ColumnDefinition{
		{Name: "owner_id", Type: "int", Nullable: "NO"},
		{Name: "parent_id", Type: "int", Nullable: "YES"},
		{Name: "note", Type: "varchar(10)", Nullable: "YES"},
	}
	keys := TableKeys{ForeignKeys: map[string]ForeignKey{
		"owner_id":  {Table: "users", Column: "id"},
		"parent_id": {Table: "items", Column: "id"},
	}}
	profiles := ClassifyTable(FamilyPostgres, columns, keys)
	plan := Plan{RowCount: 200, Seed: 3, Columns: []ColumnPlan{
		{Name: "owner_id", Generator: Generator{Kind: KindReference}},
		{Name: "parent_id", Generator: Generator{Kind: KindReference}},
		{Name: "note", NullRatio: 0.5, Generator: Generator{Kind: KindFixed, Value: "x"}},
	}}
	_, err := NewProducer(plan, profiles, References{})
	expectPlanError(t, err, ErrCodeReferenceEmpty)

	producer, err := NewProducer(plan, profiles, References{"owner_id": {"10", "20"}})
	if err != nil {
		t.Fatalf("NewProducer: %v", err)
	}
	nulls := 0
	for _, row := range collect(t, producer) {
		if owner := row["owner_id"]; owner != "10" && owner != "20" {
			t.Fatalf("owner_id = %v", owner)
		}
		if row["parent_id"] != nil {
			t.Fatalf("parent_id without parent rows should be NULL, got %v", row["parent_id"])
		}
		if row["note"] == nil {
			nulls++
		}
	}
	if nulls < 60 || nulls > 140 {
		t.Fatalf("null ratio 0.5 produced %d nulls out of 200", nulls)
	}
}

func TestProducerRespectsLengthUnits(t *testing.T) {
	profiles := profilesFor(t, "oracle",
		connection.ColumnDefinition{Name: "title", Type: "VARCHAR2(10)", Nullable: "YES"},
	)
	_, err := NewProducer(Plan{RowCount: 1, Columns: []ColumnPlan{
		{Name: "title", Generator: Generator{Kind: KindText, Locale: LocaleZH, MaxLength: 5}},
	}}, profiles, nil)
	expectPlanError(t, err, ErrCodeInvalidLength)

	producer := mustProducer(t, Plan{RowCount: 30, Seed: 9, Columns: []ColumnPlan{
		{Name: "title", Generator: Generator{Kind: KindAddress, Locale: LocaleZH}},
	}}, profiles)
	for _, row := range collect(t, producer) {
		value := row["title"].(string)
		if len(value) > 10 || !utf8.ValidString(value) {
			t.Fatalf("value %q exceeds 10 bytes or splits a character", value)
		}
	}
}

func TestProducerASCIIOnlyColumns(t *testing.T) {
	profiles := profilesFor(t, "sqlserver",
		connection.ColumnDefinition{Name: "name", Type: "varchar(50)", Nullable: "YES"},
	)
	_, err := NewProducer(Plan{RowCount: 1, Locale: LocaleZH, Columns: []ColumnPlan{
		{Name: "name", Generator: Generator{Kind: KindPersonName}},
	}}, profiles, nil)
	expectPlanError(t, err, ErrCodeASCIIOnly)

	producer := mustProducer(t, Plan{RowCount: 5, Seed: 1, Locale: LocaleZH, Columns: []ColumnPlan{
		{Name: "name", Generator: Generator{Kind: KindPersonName, Locale: LocaleEN}},
	}}, profiles)
	for _, row := range collect(t, producer) {
		if !isASCII(row["name"].(string)) {
			t.Fatalf("non-ascii value %q", row["name"])
		}
	}
}

func TestBooleanLiteralsFollowFamily(t *testing.T) {
	cases := []struct {
		dialect string
		typ     string
		want    []string
	}{
		{"postgres", "boolean", []string{"true", "false"}},
		{"mysql", "tinyint(1)", []string{"1", "0"}},
		{"sqlserver", "bit", []string{"1", "0"}},
		{"gbase8s", "boolean", []string{"t", "f"}},
	}
	for _, tc := range cases {
		t.Run(tc.dialect, func(t *testing.T) {
			profiles := profilesFor(t, tc.dialect, connection.ColumnDefinition{Name: "b", Type: tc.typ, Nullable: "YES"})
			producer := mustProducer(t, Plan{RowCount: 40, Seed: 5, Columns: []ColumnPlan{{Name: "b", Generator: Generator{Kind: KindBoolean}}}}, profiles)
			for _, row := range collect(t, producer) {
				if value := row["b"]; value != tc.want[0] && value != tc.want[1] {
					t.Fatalf("value %v not in %v", value, tc.want)
				}
			}
		})
	}
}

func TestSequenceWithPrefixAndWidth(t *testing.T) {
	profiles := profilesFor(t, "postgres", connection.ColumnDefinition{Name: "no", Type: "varchar(9)", Nullable: "NO"})
	producer := mustProducer(t, Plan{RowCount: 3, Columns: []ColumnPlan{
		{Name: "no", Generator: Generator{Kind: KindSequence, Prefix: "ORD", Start: "7", Width: 6}},
	}}, profiles)
	var got []string
	for _, row := range collect(t, producer) {
		got = append(got, row["no"].(string))
	}
	if strings.Join(got, ",") != "ORD000007,ORD000008,ORD000009" {
		t.Fatalf("sequence = %v", got)
	}
	_, err := NewProducer(Plan{RowCount: 1, Columns: []ColumnPlan{
		{Name: "no", Generator: Generator{Kind: KindSequence, Prefix: "ORDER-", Start: "7", Width: 6}},
	}}, profiles, nil)
	expectPlanError(t, err, ErrCodeValueTooLong)
}

func TestDecimalUnits(t *testing.T) {
	cases := []struct {
		text  string
		scale int
		units int64
		ok    bool
	}{
		{"12.5", 2, 1250, true},
		{"-0.01", 2, -1, true},
		{"7", 0, 7, true},
		{"1.234", 2, 0, false},
		{"abc", 2, 0, false},
	}
	for _, tc := range cases {
		units, ok := parseDecimalUnits(tc.text, tc.scale)
		if units != tc.units || ok != tc.ok {
			t.Fatalf("parseDecimalUnits(%q, %d) = %d, %v", tc.text, tc.scale, units, ok)
		}
	}
	if got := formatDecimalUnits(-5, 2); got != "-0.05" {
		t.Fatalf("formatDecimalUnits = %s", got)
	}
}
