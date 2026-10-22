package sync

import (
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestValueLengthDiagnosisMixedCharacterUnits(t *testing.T) {
	t.Parallel()
	cols := []connection.ColumnDefinition{{Name: "FITS", Type: "NVARCHAR2(2)"}, {Name: "LONG", Type: "varchar(2 BYTE)"}}
	findings := findValueLengthOverflows(cols, connection.ChangeSet{Inserts: []map[string]any{{"FITS": "中文", "LONG": "中文"}}})
	if len(findings) != 1 || findings[0].Column != "LONG" {
		t.Fatalf("national character column falsely reported: %v", findings)
	}
}

func TestValueLengthDiagnosisRespectsExplicitSemantics(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, typ, value string
		want             int
	}{
		{"characters fit", "varchar(2 CHAR)", "中文", 0},
		{"characters overflow", "varchar(2 CHAR)", "中文名", 1},
		{"bytes overflow", "varchar(2 BYTE)", "中文", 1},
		{"national variable characters fit", "NVARCHAR2(2)", "中文", 0},
		{"national variable characters overflow", "NVARCHAR2(2)", "中文名", 1},
		{"unknown semantics keep conservative diagnosis", "varchar(2)", "中文", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			findings := findValueLengthOverflows([]connection.ColumnDefinition{{Name: "NOTE", Type: tc.typ}}, connection.ChangeSet{Inserts: []map[string]any{{"NOTE": tc.value}}})
			if len(findings) != tc.want {
				t.Fatalf("got %v, want %d findings", findings, tc.want)
			}
			if tc.want > 0 && strings.Contains(tc.typ, "CHAR") {
				if got := suggestedCharColumnLength(findings[0]); got != 3 {
					t.Fatalf("character limit recommendation=%d, want 3", got)
				}
			}
		})
	}
}
