package dataexport

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"
)

type pluginExportForbidden struct{ calls *int }

func (v pluginExportForbidden) MarshalJSON() ([]byte, error) { *v.calls++; return []byte("null"), nil }

func TestPluginSnapshotSelectedOrderDeepFreezeAndSecretExclusion(t *testing.T) {
	calls := 0
	nested := map[string]any{"z": json.Number("9007199254740993"), "a": []any{json.Number("1e400"), "x\x00y"}}
	data := []map[string]any{{"number": int64(math.MaxInt64), "nil": nil, "text": "AQI=", "nested": nested, "binary": []byte{0, 255}, "secret": pluginExportForbidden{&calls}}}
	columns := []string{"secret", "number", "nil", "missing", "text", "nested", "binary"}
	selected := []string{"binary", "missing", "nil", "number", "text", "nested"}
	snapshot, err := PreparePluginExportSnapshot(context.Background(), data, columns, selected)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(snapshot.Columns, ",") != strings.Join(selected, ",") || calls != 0 {
		t.Fatal("selected projection/order changed")
	}
	row := snapshot.Rows[0]
	if row[0].Kind != "binary" || *row[0].Value != "AP8=" || row[1].Kind != "missing" || row[1].Value != nil || row[2].Kind != "null" || row[2].Value != nil || *row[3].Value != "9223372036854775807" || row[4].Kind != "string" || *row[4].Value != "AQI=" {
		t.Fatal("tagged fidelity changed")
	}
	expected := `{"a":[1e400,"x\u0000y"],"z":9007199254740993}`
	if row[5].Kind != "json" || *row[5].Value != expected {
		t.Fatalf("nested lexical fidelity: %s", *row[5].Value)
	}
	nested["a"] = nil
	data[0]["number"] = 0
	data[0]["binary"].([]byte)[0] = 1
	selected[0] = "secret"
	if snapshot.Columns[0] != "binary" || *row[0].Value != "AP8=" || *row[3].Value != "9223372036854775807" || *row[5].Value != expected {
		t.Fatal("snapshot retained mutable aliases")
	}
	raw, err := json.Marshal(snapshot)
	if err != nil || strings.Contains(string(raw), "secret") {
		t.Fatal("unselected column metadata leaked")
	}
}
func TestPluginSnapshotScalarFidelity(t *testing.T) {
	stamp := time.Date(2024, 1, 2, 3, 4, 5, 123, time.FixedZone("test", 3600))
	cases := []struct {
		name       string
		value      any
		kind, text string
	}{
		{"uint64", uint64(math.MaxUint64), "number", "18446744073709551615"},
		{"decimal", json.Number("1.230000000000000001"), "number", "1.230000000000000001"},
		{"large exponent", json.Number("1e400"), "number", "1e400"},
		{"negative zero", json.Number("-0"), "number", "-0"},
		{"safe float", float64(9007199254740991), "number", "9.007199254740991e+15"},
		{"boolean", true, "boolean", "true"},
		{"NUL string", "a\x00b", "string", "a\x00b"},
		{"empty binary", []byte{}, "binary", ""},
		{"nil binary", []byte(nil), "null", ""},
		{"nil map", map[string]any(nil), "null", ""},
		{"nil slice", []any(nil), "null", ""},
		{"time", stamp, "string", stamp.Format(time.RFC3339Nano)},
		{"raw scalar", json.RawMessage(`"value"`), "json", `"value"`},
		{"raw number", json.RawMessage(`1e400`), "json", "1e400"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			s, err := PreparePluginExportSnapshot(context.Background(), []map[string]any{{"x": test.value}}, []string{"x"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			cell := s.Rows[0][0]
			if cell.Kind != test.kind || (test.kind == "null" && cell.Value != nil) || (test.kind != "null" && (cell.Value == nil || *cell.Value != test.text)) {
				t.Fatalf("unexpected cell: %+v", cell)
			}
		})
	}
}
func TestPluginSnapshotRejectsUnsupportedOrDamagedData(t *testing.T) {
	calls := 0
	cycle := map[string]any{}
	cycle["self"] = cycle
	cases := []struct {
		name  string
		value any
	}{
		{"unsafe integral float", float64(9007199254740992)}, {"NaN", math.NaN()}, {"infinite", math.Inf(1)},
		{"invalid number", json.Number("01")}, {"long number", json.Number(strings.Repeat("1", 257))},
		{"invalid UTF8", string([]byte{255})}, {"cycle", cycle}, {"pointer", new(int)},
		{"custom callback", pluginExportForbidden{&calls}}, {"nested binary", []any{[]byte{1}}}, {"nested time", []any{time.Now()}},
		{"nil raw", json.RawMessage(nil)}, {"duplicate raw", json.RawMessage(`{"x":1,"\u0078":2}`)},
		{"unpaired surrogate", json.RawMessage(`"\ud800"`)}, {"oversized cell", strings.Repeat("x", (128<<10)+1)},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			s, err := PreparePluginExportSnapshot(context.Background(), []map[string]any{{"x": test.value}}, []string{"x"}, nil)
			if err == nil || s.Columns != nil || s.Rows != nil {
				t.Fatal("invalid data yielded partial snapshot")
			}
		})
	}
	if calls != 0 {
		t.Fatal("custom serialization executed")
	}
}
func TestPluginSnapshotColumnShapeAndCancellation(t *testing.T) {
	for _, selected := range [][]string{{}, {"unknown"}, {"x", "x"}} {
		if _, err := PreparePluginExportSnapshot(context.Background(), nil, []string{"x"}, selected); err == nil {
			t.Fatal("invalid selection accepted")
		}
	}
	for _, columns := range [][]string{{}, {"x", "x"}, {" "}, {"bad\x00name"}} {
		if _, err := PreparePluginExportSnapshot(context.Background(), nil, columns, nil); err == nil {
			t.Fatal("invalid source columns accepted")
		}
	}
	s, err := PreparePluginExportSnapshot(context.Background(), nil, []string{" x "}, nil)
	if err != nil || s.Columns[0] != " x " || s.Rows == nil || len(s.Rows) != 0 {
		t.Fatal("zero rows/spaces were normalized")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := PreparePluginExportSnapshot(ctx, nil, nil, nil); err != context.Canceled {
		t.Fatal("canceled caller lost priority")
	}
	if _, err := PreparePluginExportSnapshot(context.Background(), make([]map[string]any, 4097), []string{"x"}, nil); err == nil {
		t.Fatal("row count exceeded")
	}
}
