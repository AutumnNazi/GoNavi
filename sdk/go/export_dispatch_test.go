package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func exportTestCell(t *testing.T, kind ExporterCellKind, value string) ExporterCell {
	t.Helper()
	cell, err := NewExporterCell(kind, value)
	if err != nil {
		t.Fatal(err)
	}
	return cell
}
func exportTestRaw(t *testing.T, id string, snapshot ExporterSnapshot) json.RawMessage {
	t.Helper()
	raw, err := EncodeExporterRequest(context.Background(), id, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func exportTestSnapshot(t *testing.T) ExporterSnapshot {
	return ExporterSnapshot{Columns: []string{"value"}, Rows: [][]ExporterCell{{exportTestCell(t, ExporterString, "data")}}}
}

func TestExporterDispatcherOwnRegistryFidelityAndResult(t *testing.T) {
	snapshot := ExporterSnapshot{Columns: []string{" number ", "__proto__", "constructor", "missing", "null", "binary", "json"}, Rows: [][]ExporterCell{{
		exportTestCell(t, ExporterNumber, "1e400"), exportTestCell(t, ExporterString, "zero\x00line\n"), exportTestCell(t, ExporterBoolean, "true"),
		exportTestCell(t, ExporterMissing, ""), exportTestCell(t, ExporterNull, ""), exportTestCell(t, ExporterBinary, "AAH/"), exportTestCell(t, ExporterJSON, `{"big":18446744073709551615,"e":1e400}`),
	}}}
	var observed ExporterSnapshot
	handlers := map[string]ExporterRender{"constructor": func(_ context.Context, input ExporterSnapshot) (string, error) {
		observed = input
		return "document", nil
	}}
	dispatcher, err := NewExporterDispatcher(handlers)
	if err != nil {
		t.Fatal(err)
	}
	handlers["constructor"] = func(context.Context, ExporterSnapshot) (string, error) {
		t.Fatal("registry was not copied")
		return "", nil
	}
	result, err := dispatcher.Handle(context.Background(), exportTestRaw(t, "constructor", snapshot))
	if err != nil {
		t.Fatal(err)
	}
	document := result.(ExporterResult)
	if document.ProtocolVersion != 1 || document.RowCount != 1 || document.Text != "document" || observed.Columns[0] != " number " || *observed.Rows[0][0].Value != "1e400" || *observed.Rows[0][1].Value != "zero\x00line\n" || observed.Rows[0][3].Value != nil {
		t.Fatal("snapshot fidelity changed")
	}
	for _, id := range []string{"missing", "CONSTRUCTOR", " constructor"} {
		raw := strings.Replace(string(exportTestRaw(t, "constructor", snapshot)), `"constructor",`, `"`+id+`",`, 1)
		if _, err = dispatcher.Handle(context.Background(), json.RawMessage(raw)); err == nil {
			t.Fatal("unknown identity accepted")
		}
	}
}

func TestExporterRejectsMalformedBeforeCallback(t *testing.T) {
	calls := 0
	dispatcher, err := NewExporterDispatcher(map[string]ExporterRender{"ndjson": func(context.Context, ExporterSnapshot) (string, error) { calls++; return "document", nil }})
	if err != nil {
		t.Fatal(err)
	}
	base := string(exportTestRaw(t, "ndjson", exportTestSnapshot(t)))
	tests := []string{
		strings.Replace(base, `"protocolVersion":1`, `"protocolVersion":1,"protocolVersion":1`, 1),
		strings.Replace(base, `"exporterId"`, `"ExporterId"`, 1),
		strings.Replace(base, `"exporterId":"ndjson"`, `"exporterId":"ndjson","\u0065xporterId":"ndjson"`, 1),
		strings.Replace(base, `"columns":["value"]`, `"columns":null`, 1),
		strings.Replace(base, `"rows":[[{"kind":"string","value":"data"}]]`, `"rows":[null]`, 1),
		strings.Replace(base, `"kind":"string"`, `"kind":"missing"`, 1),
		strings.Replace(base, `"value":"data"`, `"value":null`, 1),
		strings.Replace(base, `"value":"data"`, `"value":"\ud800"`, 1),
		strings.Replace(base, `"protocolVersion":1`, `"protocolVersion":1.0`, 1),
		strings.Replace(base, `"columns":["value"]`, `"columns":["value","value"]`, 1),
		strings.TrimSuffix(base, "}") + `,"connection":"secret"}`,
	}
	for _, raw := range tests {
		if _, err = dispatcher.Handle(context.Background(), json.RawMessage(raw)); err == nil {
			t.Fatalf("malformed envelope accepted: %.80s", raw)
		}
	}
	if calls != 0 {
		t.Fatalf("invalid input called renderer %d times", calls)
	}
}

func TestExporterCancellationPanicAndUnsafeOutput(t *testing.T) {
	for _, test := range []struct {
		name   string
		render ExporterRender
	}{
		{"panic", func(context.Context, ExporterSnapshot) (string, error) { panic("private-row-secret") }},
		{"error", func(context.Context, ExporterSnapshot) (string, error) { return "", errors.New("private-row-secret") }},
		{"NUL", func(context.Context, ExporterSnapshot) (string, error) { return "bad\x00text", nil }},
		{"empty", func(context.Context, ExporterSnapshot) (string, error) { return "", nil }},
		{"UTF8", func(context.Context, ExporterSnapshot) (string, error) { return string([]byte{0xff}), nil }},
		{"escaped wire size", func(context.Context, ExporterSnapshot) (string, error) { return strings.Repeat("\"", 300000), nil }},
	} {
		t.Run(test.name, func(t *testing.T) {
			d, err := NewExporterDispatcher(map[string]ExporterRender{"ndjson": test.render})
			if err != nil {
				t.Fatal(err)
			}
			_, err = d.Handle(context.Background(), exportTestRaw(t, "ndjson", exportTestSnapshot(t)))
			if err == nil || strings.Contains(err.Error(), "private-row-secret") {
				t.Fatalf("unsafe callback outcome: %v", err)
			}
		})
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	d, err := NewExporterDispatcher(map[string]ExporterRender{"ndjson": func(ctx context.Context, _ ExporterSnapshot) (string, error) {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "document", nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = d.Handle(canceled, exportTestRaw(t, "ndjson", exportTestSnapshot(t))); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel not preserved: %v", err)
	}
	if _, err = d.Handle(nil, nil); err == nil {
		t.Fatal("nil context accepted")
	}
	empty := ExporterSnapshot{Columns: []string{"x"}, Rows: [][]ExporterCell{}}
	d, err = NewExporterDispatcher(map[string]ExporterRender{"ndjson": func(context.Context, ExporterSnapshot) (string, error) { return "", nil }})
	if err != nil {
		t.Fatal(err)
	}
	value, err := d.Handle(context.Background(), exportTestRaw(t, "ndjson", empty))
	if err != nil || value.(ExporterResult).RowCount != 0 {
		t.Fatalf("zero rows: %v", err)
	}
}
