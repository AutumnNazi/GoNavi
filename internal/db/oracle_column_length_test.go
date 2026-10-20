package db

import (
	"database/sql/driver"
	"strings"
	"testing"
)

func TestFormatOracleColumnTypeLengthSemantics(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		dataType   string
		charUsed   interface{}
		charLength interface{}
		dataLength interface{}
		want       string
	}{
		{name: "varchar characters", dataType: "VARCHAR2", charUsed: "C", charLength: 10, dataLength: 40, want: "VARCHAR2(10 CHAR)"},
		{name: "char characters", dataType: "CHAR", charUsed: "C", charLength: 10, dataLength: 40, want: "CHAR(10 CHAR)"},
		{name: "varchar bytes", dataType: "VARCHAR2", charUsed: "B", charLength: 3, dataLength: 12, want: "VARCHAR2(12 BYTE)"},
		{name: "char bytes", dataType: "CHAR", charUsed: "B", charLength: 3, dataLength: 12, want: "CHAR(12 BYTE)"},
		{name: "case insensitive", dataType: "varchar2", charUsed: " c ", charLength: 10, dataLength: 40, want: "varchar2(10 CHAR)"},
		{name: "nil semantics", dataType: "VARCHAR2", charUsed: nil, charLength: 10, dataLength: 40, want: "VARCHAR2(10)"},
		{name: "empty semantics", dataType: "VARCHAR2", charUsed: "", charLength: 10, dataLength: 40, want: "VARCHAR2(10)"},
		{name: "unknown semantics", dataType: "VARCHAR2", charUsed: "?", charLength: 10, dataLength: 40, want: "VARCHAR2(10)"},
		{name: "legacy data length", dataType: "CHAR", charUsed: nil, charLength: nil, dataLength: 40, want: "CHAR(40)"},
		{name: "national characters", dataType: "NCHAR", charUsed: "C", charLength: 10, dataLength: 20, want: "NCHAR(10)"},
		{name: "national varchar", dataType: "NVARCHAR2", charUsed: "C", charLength: 10, dataLength: 20, want: "NVARCHAR2(10)"},
		{name: "national cannot have byte modifier", dataType: "NVARCHAR2", charUsed: "B", charLength: 10, dataLength: 20, want: "NVARCHAR2(10)"},
		{name: "raw has no character modifier", dataType: "RAW", charUsed: "C", charLength: 0, dataLength: 16, want: "RAW(16)"},
		{name: "raw has no byte modifier", dataType: "RAW", charUsed: "B", charLength: 0, dataLength: 16, want: "RAW(16)"},
		{name: "preformatted type", dataType: "VARCHAR2(10 BYTE)", charUsed: "C", charLength: 10, dataLength: 40, want: "VARCHAR2(10 BYTE)"},
		{name: "missing lengths", dataType: "VARCHAR2", charUsed: "C", charLength: nil, dataLength: nil, want: "VARCHAR2"},
		{name: "invalid lengths", dataType: "VARCHAR2", charUsed: "B", charLength: 0, dataLength: -1, want: "VARCHAR2"},
		{name: "no character count", dataType: "VARCHAR2", charUsed: "C", charLength: nil, dataLength: 40, want: "VARCHAR2(40)"},
		{name: "no byte count", dataType: "VARCHAR2", charUsed: "B", charLength: 10, dataLength: nil, want: "VARCHAR2(10)"},
		{name: "clob unchanged", dataType: "CLOB", charUsed: "C", charLength: 0, dataLength: 4000, want: "CLOB"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			row := map[string]interface{}{
				"DATA_TYPE": tc.dataType, "CHAR_USED": tc.charUsed,
				"CHAR_LENGTH": tc.charLength, "DATA_LENGTH": tc.dataLength,
			}
			if got := FormatOracleColumnType(row); got != tc.want {
				t.Fatalf("FormatOracleColumnType() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestOracleGetColumnsBatchPreservesLengthSemantics(t *testing.T) {
	t.Parallel()
	for _, schema := range []string{"", "APP"} {
		for _, withIdentity := range []bool{false, true} {
			name := schema + "/legacy"
			if withIdentity {
				name = schema + "/identity"
			}
			t.Run(name, func(t *testing.T) {
				conn, state := openOracleRecordingDB(t)
				state.mu.Lock()
				if withIdentity {
					state.queryResults[oracleIdentityProbeQuery(schema)] = oracleRecordingQueryResult{columns: []string{"IDENTITY_PROBE"}}
				}
				state.queryResults[buildOracleColumnsBatchQuery(schema, []string{"ITEMS"}, withIdentity)] = oracleRecordingQueryResult{
					columns: []string{"TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "DATA_LENGTH", "CHAR_LENGTH", "CHAR_USED"},
					rows: [][]driver.Value{
						{"ITEMS", "LABEL", "VARCHAR2", int64(40), int64(10), "C"},
						{"ITEMS", "CODE", "CHAR", int64(12), int64(3), "B"},
					},
				}
				state.mu.Unlock()
				grouped, err := (&OracleDB{conn: conn}).GetColumnsBatch(schema, []string{"ITEMS"})
				if err != nil {
					t.Fatal(err)
				}
				columns := grouped["ITEMS"]
				if len(columns) != 2 {
					t.Fatalf("expected two columns, got %#v", grouped)
				}
				for i, want := range []string{"VARCHAR2(10 CHAR)", "CHAR(12 BYTE)"} {
					if columns[i].Type != want {
						t.Errorf("column %s type = %q, want %q", columns[i].Name, columns[i].Type, want)
					}
				}
			})
		}
	}
}

func TestOracleGetAllColumnsPreservesLengthSemantics(t *testing.T) {
	t.Parallel()
	conn, state := openOracleRecordingDB(t)
	oracle := &OracleDB{conn: conn}
	if _, err := oracle.GetAllColumns("APP"); err != nil {
		t.Fatal(err)
	}
	queries := state.snapshotQueries()
	if len(queries) != 1 {
		t.Fatalf("expected one dictionary query, got %v", queries)
	}
	for _, field := range []string{"c.char_used", "c.char_length", "c.data_length"} {
		if !strings.Contains(queries[0], field) {
			t.Errorf("all-column dictionary query must select %s", field)
		}
	}
	state.mu.Lock()
	state.queryResults[queries[0]] = oracleRecordingQueryResult{
		columns: []string{"TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "DATA_LENGTH", "CHAR_LENGTH", "CHAR_USED", "COMMENT"},
		rows: [][]driver.Value{
			{"ITEMS", "LABEL", "VARCHAR2", int64(40), int64(10), "C", "label"},
			{"ITEMS", "CODE", "CHAR", int64(12), int64(3), "B", "code"},
		},
	}
	state.mu.Unlock()
	columns, err := oracle.GetAllColumns("APP")
	if err != nil {
		t.Fatal(err)
	}
	if len(columns) != 2 {
		t.Fatalf("expected two columns, got %#v", columns)
	}
	for i, want := range []string{"VARCHAR2(10 CHAR)", "CHAR(12 BYTE)"} {
		if columns[i].TableName != "ITEMS" || columns[i].Type != want {
			t.Errorf("column = %#v, want ITEMS with type %q", columns[i], want)
		}
	}
}

func TestOracleColumnsQueriesSelectLengthSemantics(t *testing.T) {
	t.Parallel()
	for _, schema := range []string{"", "APP"} {
		queries := map[string]string{
			"single":         buildOracleColumnsQuery(schema, "ITEMS"),
			"identity":       buildOracleColumnsQueryWithIdentity(schema, "ITEMS"),
			"batch":          buildOracleColumnsBatchQuery(schema, []string{"ITEMS"}, false),
			"batch identity": buildOracleColumnsBatchQuery(schema, []string{"ITEMS"}, true),
		}
		for name, query := range queries {
			t.Run(schema+"/"+name, func(t *testing.T) {
				for _, projection := range []string{
					`c.char_used AS "CHAR_USED"`,
					`c.char_length AS "CHAR_LENGTH"`,
					`c.data_length AS "DATA_LENGTH"`,
				} {
					if !strings.Contains(query, projection) {
						t.Errorf("missing length metadata projection %s", projection)
					}
				}
			})
		}
	}
}

func TestOracleGetColumnsPreservesLengthSemantics(t *testing.T) {
	t.Parallel()

	conn, state := openOracleRecordingDB(t)
	state.mu.Lock()
	state.queryResults[buildOracleColumnsQuery("APP", "ITEMS")] = oracleRecordingQueryResult{
		columns: []string{"COLUMN_NAME", "DATA_TYPE", "DATA_LENGTH", "CHAR_LENGTH", "CHAR_USED"},
		rows: [][]driver.Value{
			{"LABEL", "VARCHAR2", int64(40), int64(10), "C"},
			{"CODE", "CHAR", int64(12), int64(3), "B"},
		},
	}
	state.mu.Unlock()

	columns, err := (&OracleDB{conn: conn}).GetColumns("APP", "ITEMS")
	if err != nil {
		t.Fatal(err)
	}
	if len(columns) != 2 {
		t.Fatalf("expected two columns, got %#v", columns)
	}
	for i, want := range []string{"VARCHAR2(10 CHAR)", "CHAR(12 BYTE)"} {
		if columns[i].Type != want {
			t.Errorf("column %s type = %q, want %q", columns[i].Name, columns[i].Type, want)
		}
	}
}
