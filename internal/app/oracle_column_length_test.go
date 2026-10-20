package app

import (
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestOracleMetadataFallbackPreservesLengthSemantics(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		row  map[string]interface{}
		want string
	}{
		{
			name: "character length",
			row:  map[string]interface{}{"COLUMN_NAME": "LABEL", "DATA_TYPE": "VARCHAR2", "DATA_LENGTH": 40, "CHAR_LENGTH": 10, "CHAR_USED": "C"},
			want: "VARCHAR2(10 CHAR)",
		},
		{
			name: "byte length",
			row:  map[string]interface{}{"COLUMN_NAME": "LABEL", "DATA_TYPE": "CHAR", "DATA_LENGTH": 12, "CHAR_LENGTH": 3, "CHAR_USED": "B"},
			want: "CHAR(12 BYTE)",
		},
		{
			name: "driver byte slices and fallback aliases",
			row:  map[string]interface{}{"column_name": []byte("LABEL"), "type_name": []byte("VARCHAR2"), "data_length": []byte("40"), "char_col_decl_length": []byte("10"), "char_used": []byte(" c ")},
			want: "VARCHAR2(10 CHAR)",
		},
		{
			name: "unknown semantics",
			row:  map[string]interface{}{"COLUMN_NAME": "LABEL", "DATA_TYPE": "VARCHAR2", "DATA_LENGTH": 40, "CHAR_LENGTH": 10},
			want: "VARCHAR2(10)",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			inst := &fakeOracleMetadataDB{rows: []map[string]interface{}{tc.row}}
			columns, err := getColumnsWithMetadataFallback(inst, connection.ConnectionConfig{Type: "oracle"}, "APP", "ITEMS", nil)
			if err != nil {
				t.Fatal(err)
			}
			if len(columns) != 1 || columns[0].Type != tc.want {
				t.Fatalf("fallback columns = %#v, want type %q", columns, tc.want)
			}
		})
	}
}

func TestAppOracleColumnsQuerySelectsLengthSemantics(t *testing.T) {
	t.Parallel()
	for _, schema := range []string{"", "APP"} {
		t.Run(schema, func(t *testing.T) {
			query := buildAppOracleColumnsQuery(schema, "ITEMS")
			if !strings.Contains(query, `c.char_used AS "CHAR_USED"`) {
				t.Fatal("dictionary fallback query must select CHAR_USED")
			}
		})
	}
}
