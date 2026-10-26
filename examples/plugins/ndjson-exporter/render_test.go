package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func goldenSnapshot(t *testing.T) plugin.ExporterSnapshot {
	t.Helper()
	makeCell := func(kind plugin.ExporterCellKind, value string) plugin.ExporterCell {
		cell, err := plugin.NewExporterCell(kind, value)
		if err != nil {
			t.Fatal(err)
		}
		return cell
	}
	return plugin.ExporterSnapshot{Columns: []string{" big ", "__proto__", "constructor", "missing", "null", "binary", "json", "bool"}, Rows: [][]plugin.ExporterCell{{
		makeCell(plugin.ExporterNumber, "18446744073709551615"), makeCell(plugin.ExporterString, "NUL\x00\n"), makeCell(plugin.ExporterNumber, "1e400"),
		makeCell(plugin.ExporterMissing, ""), makeCell(plugin.ExporterNull, ""), makeCell(plugin.ExporterBinary, "AAH/"),
		makeCell(plugin.ExporterJSON, `{"n":9007199254740993,"e":1e400}`), makeCell(plugin.ExporterBoolean, "false"),
	}}}
}

const goldenDocument = `{" big ":{"kind":"number","value":18446744073709551615},"__proto__":{"kind":"string","value":"NUL\u0000\n"},"constructor":{"kind":"number","value":1e400},"missing":{"kind":"missing"},"null":{"kind":"null"},"binary":{"kind":"binary","value":"AAH/"},"json":{"kind":"json","value":{"n":9007199254740993,"e":1e400}},"bool":{"kind":"boolean","value":false}}` + "\n"

func TestTypedNDJSONGoldenThroughDispatcher(t *testing.T) {
	dispatcher, err := plugin.NewExporterDispatcher(map[string]plugin.ExporterRender{"ndjson": renderNDJSON})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := plugin.EncodeExporterRequest(context.Background(), "ndjson", goldenSnapshot(t))
	if err != nil {
		t.Fatal(err)
	}
	value, err := dispatcher.Handle(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	result := value.(plugin.ExporterResult)
	if result.Text != goldenDocument || result.RowCount != 1 || strings.ContainsRune(result.Text, 0) {
		t.Fatalf("fidelity mismatch: %q", result.Text)
	}
	decoder := json.NewDecoder(strings.NewReader(result.Text))
	decoder.UseNumber()
	var row map[string]map[string]any
	if err = decoder.Decode(&row); err != nil {
		t.Fatal(err)
	}
	if row[" big "]["value"] != json.Number("18446744073709551615") || row["constructor"]["value"] != json.Number("1e400") || row["__proto__"]["value"] != "NUL\x00\n" {
		t.Fatal("numeric or prototype-name fidelity lost")
	}
}

func TestTypedNDJSONEmptyAndCanceled(t *testing.T) {
	result, err := renderNDJSON(context.Background(), plugin.ExporterSnapshot{Columns: []string{"value"}, Rows: [][]plugin.ExporterCell{}})
	if err != nil || result != "" {
		t.Fatalf("empty document: %q %v", result, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = renderNDJSON(ctx, goldenSnapshot(t)); err == nil {
		t.Fatal("canceled render returned data")
	}
}
