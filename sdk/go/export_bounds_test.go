package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestExporterExactEnvelopeBudget(t *testing.T) {
	columns := []string{"a", "b", "c", "d"}
	row := make([]ExporterCell, 4)
	for index := 0; index < 3; index++ {
		row[index] = exportTestCell(t, ExporterString, strings.Repeat("x", 128<<10))
	}
	row[3] = exportTestCell(t, ExporterString, "")
	request := ExporterRequest{ProtocolVersion: 1, ExporterID: "ndjson", Columns: columns, Rows: [][]ExporterCell{row}}
	base, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	fill := strings.Repeat("x", ExporterMaxEnvelopeBytes-len(base))
	request.Rows[0][3].Value = &fill
	raw, err := json.Marshal(request)
	if err != nil || len(raw) != ExporterMaxEnvelopeBytes {
		t.Fatal("bad boundary fixture")
	}
	calls := 0
	d, err := NewExporterDispatcher(map[string]ExporterRender{"ndjson": func(context.Context, ExporterSnapshot) (string, error) { calls++; return "document", nil }})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = d.Handle(context.Background(), raw); err != nil {
		t.Fatalf("exact envelope rejected: %v", err)
	}
	fill += "x"
	raw, err = json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = d.Handle(context.Background(), raw); err == nil || calls != 1 {
		t.Fatal("oversize reached callback")
	}
}

func TestExporterLogicalNodesAndDepth(t *testing.T) {
	// root+two header values+columns/rows containers+two columns+one row+two(cell+kind)=12;
	// JSON roots replace the two value strings and each array contributes one node.
	request := ExporterRequest{ProtocolVersion: 1, ExporterID: "ndjson", Columns: []string{"a", "b"}}
	array := func(count int) string { return "[" + strings.TrimSuffix(strings.Repeat("0,", count), ",") + "]" }
	for _, count := range []int{65529, 65530} {
		value := array(count)
		request.Rows = [][]ExporterCell{{{Kind: ExporterJSON, Value: &value}, {Kind: ExporterJSON, Value: &value}}}
		raw, err := json.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		_, err = decodeExporterRequest(context.Background(), raw)
		if (err == nil) != (count == 65529) {
			t.Fatalf("logical nodes count %d: %v", count, err)
		}
	}
	for _, depth := range []int{28, 29} {
		rawJSON := strings.Repeat("[", depth) + "0" + strings.Repeat("]", depth)
		snapshot := ExporterSnapshot{Columns: []string{"x"}, Rows: [][]ExporterCell{{{Kind: ExporterJSON, Value: &rawJSON}}}}
		_, err := EncodeExporterRequest(context.Background(), "ndjson", snapshot)
		if (err == nil) != (depth == 28) {
			t.Fatalf("expanded depth %d: %v", depth, err)
		}
	}
}

func TestExporterCellAndRegistryBounds(t *testing.T) {
	for _, test := range []struct {
		kind  ExporterCellKind
		value string
		valid bool
	}{
		{ExporterNumber, "1e400", true}, {ExporterNumber, "18446744073709551615", true}, {ExporterNumber, "-0", true}, {ExporterNumber, "01", false},
		{ExporterNumber, "+1", false}, {ExporterNumber, "NaN", false}, {ExporterJSON, `{"n":1e400,"large":18446744073709551615}`, true},
		{ExporterJSON, `{"a":1,"\u0061":2}`, false}, {ExporterJSON, `"\ud800"`, false}, {ExporterJSON, "null", true},
		{ExporterString, "\x00", true}, {ExporterBinary, "", true}, {ExporterBinary, "AA==", true}, {ExporterBinary, "AB==", false}, {ExporterBinary, "AA==\n", false},
	} {
		_, err := NewExporterCell(test.kind, test.value)
		if (err == nil) != test.valid {
			t.Fatalf("cell %s: %v", test.kind, err)
		}
	}
	handlers := map[string]ExporterRender{}
	render := func(context.Context, ExporterSnapshot) (string, error) { return "text", nil }
	for index := 0; index < 8; index++ {
		handlers[fmt.Sprint("export", index)] = render
	}
	if _, err := NewExporterDispatcher(handlers); err != nil {
		t.Fatal(err)
	}
	handlers["extra"] = render
	if _, err := NewExporterDispatcher(handlers); err == nil {
		t.Fatal("ninth handler accepted")
	}
}
