package dataexport

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func TestPluginExporterRealSDKGoldenAndBoundaries(t *testing.T) {
	manager, exporter, _ := pluginExporterFixture(t, false)
	ctx := context.Background()
	t.Run("ordered typed golden", func(t *testing.T) {
		data := []map[string]any{{"large": uint64(math.MaxUint64), "decimal": json.Number("1e400"), "string": "x\x00y", "nil": nil, "binary": []byte{0, 255}, "object": map[string]any{"z": json.Number("9007199254740993"), "a": "value"}, "secret": "NEVER_EXPORT"}}
		selected := []string{"missing", "nil", "large", "decimal", "string", "binary", "object"}
		columns := append(append([]string{}, selected...), "secret")
		snapshot, err := PreparePluginExportSnapshot(ctx, data, columns, selected)
		if err != nil {
			t.Fatal(err)
		}
		output, err := exporter.Render(ctx, snapshot)
		if err != nil {
			t.Fatal(err)
		}
		expected := `{"missing":{"kind":"missing"},"nil":{"kind":"null"},"large":{"kind":"number","value":18446744073709551615},"decimal":{"kind":"number","value":1e400},"string":{"kind":"string","value":"x\u0000y"},"binary":{"kind":"binary","value":"AP8="},"object":{"kind":"json","value":{"a":"value","z":9007199254740993}}}` + "\n"
		if string(output) != expected || strings.Contains(string(output), "NEVER_EXPORT") {
			t.Fatalf("wrong typed NDJSON: %s", output)
		}
		if _, err = manager.Invoke(ctx, exporter.pluginID, exporter.Descriptor().Command, json.RawMessage("{}")); err == nil {
			t.Fatal("generic command bypass")
		}
	})
	t.Run("zero rows", func(t *testing.T) {
		snapshot, err := PreparePluginExportSnapshot(ctx, nil, []string{"x"}, nil)
		if err != nil {
			t.Fatal(err)
		}
		output, err := exporter.Render(ctx, snapshot)
		if err != nil || len(output) != 0 {
			t.Fatalf("empty snapshot failed: %v", err)
		}
	})
	t.Run("shared logical node boundary", func(t *testing.T) {
		for _, size := range []int{32764, 32765} {
			value := json.RawMessage("[" + strings.Repeat("0,", 32761) + "0]")
			last := json.RawMessage("[" + strings.Repeat("0,", size-1) + "0]")
			data := []map[string]any{{"a": value, "b": value, "c": value, "d": last}}
			snapshot, err := PreparePluginExportSnapshot(ctx, data, []string{"a", "b", "c", "d"}, nil)
			if size == 32765 {
				if err == nil {
					t.Fatal("131073 logical nodes accepted")
				}
				continue
			}
			if err != nil {
				t.Fatalf("131072 logical nodes rejected: %v", err)
			}
			if _, err = exporter.Render(ctx, snapshot); err != nil {
				t.Fatalf("SDK/domain node mismatch: %v", err)
			}
		}
	})
	t.Run("full envelope logical depth", func(t *testing.T) {
		for _, depth := range []int{28, 29} {
			raw := json.RawMessage(strings.Repeat(`{"x":`, depth) + "0" + strings.Repeat("}", depth))
			snapshot, err := PreparePluginExportSnapshot(ctx, []map[string]any{{"x": raw}}, []string{"x"}, nil)
			if depth == 29 {
				if err == nil {
					t.Fatal("depth33 accepted")
				}
				continue
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err = exporter.Render(ctx, snapshot); err != nil {
				t.Fatalf("SDK/domain depth32 mismatch: %v", err)
			}
		}
	})
	t.Run("generation cannot rebind", func(t *testing.T) {
		if _, err := manager.SetEnabled(ctx, exporter.pluginID, false); err != nil {
			t.Fatal(err)
		}
		if err := exporter.Check(ctx); err == nil {
			t.Fatal("disabled renderer retained authority")
		}
		if _, err := manager.SetEnabled(ctx, exporter.pluginID, true); err != nil {
			t.Fatal(err)
		}
		pluginWaitExporter(t, manager, exporter.pluginID)
		if err := exporter.Check(ctx); err == nil {
			t.Fatal("old renderer silently rebound")
		}
	})
}
