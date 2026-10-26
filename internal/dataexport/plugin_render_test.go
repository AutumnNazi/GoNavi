package dataexport

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestPluginExporterStrictReplyAndNoReplay(t *testing.T) {
	_, exporter, _ := pluginExporterFixture(t, false)
	ctx := context.Background()
	snapshot, err := PreparePluginExportSnapshot(ctx, []map[string]any{{"x": "value"}}, []string{"x"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	cases := []string{
		`{}`, `{"protocolVersion":1,"rowCount":1,"text":null}`, `{"protocolVersion":1,"rowCount":0,"text":"x"}`,
		`{"protocolVersion":1,"rowCount":1.5,"text":"x"}`, `{"protocolVersion":2,"rowCount":1,"text":"x"}`,
		`{"protocolVersion":1,"rowCount":1,"text":""}`, `{"protocolVersion":1,"rowCount":1,"text":"\u0000"}`,
		`{"protocolVersion":1,"rowCount":1,"text":"x","text":"y"}`,
		`{"protocolVersion":1,"rowCount":1,"text":"x","filename":"escape.txt"}`,
		`{"protocolVersion":1,"rowCount":1,"Text":"x"}`, `{"protocolVersion":1,"rowCount":1,"text":"\ud800"}`,
	}
	for _, value := range cases {
		t.Run(value, func(t *testing.T) {
			calls := 0
			exporter.invoke = func(context.Context, json.RawMessage) (json.RawMessage, error) { calls++; return []byte(value), nil }
			output, err := exporter.Render(ctx, snapshot)
			if err != ErrPluginExportRender || output != nil || calls != 1 {
				t.Fatalf("invalid reply succeeded/replayed: %v calls=%d", err, calls)
			}
		})
	}
	cause := errors.New("SECRET/path output failure")
	calls := 0
	exporter.invoke = func(context.Context, json.RawMessage) (json.RawMessage, error) { calls++; return nil, cause }
	if output, err := exporter.Render(ctx, snapshot); output != nil || err != ErrPluginExportRender || errors.Is(err, cause) || calls != 1 {
		t.Fatal("native error disclosed or replayed")
	}
}
func TestPluginExporterExactEnvelopeBytesBeforeRPC(t *testing.T) {
	_, exporter, _ := pluginExporterFixture(t, false)
	ctx := context.Background()
	columns := []string{"a", "b", "c", "d"}
	snapshot := PluginExportSnapshot{Columns: columns, Rows: [][]PluginExportCell{{}}}
	for range columns {
		value := ""
		snapshot.Rows[0] = append(snapshot.Rows[0], PluginExportCell{Kind: "string", Value: &value})
	}
	raw, err := json.Marshal(pluginExportRequest{ProtocolVersion: 1, ExporterID: exporter.Descriptor().ID, Columns: columns, Rows: snapshot.Rows})
	if err != nil {
		t.Fatal(err)
	}
	remaining := pluginExportMaxBytes - len(raw)
	for i := range snapshot.Rows[0] {
		size := pluginExportCellBytes
		if size > remaining {
			size = remaining
		}
		value := strings.Repeat("x", size)
		snapshot.Rows[0][i].Value = &value
		remaining -= size
	}
	if remaining != 0 {
		t.Fatal("invalid byte fixture")
	}
	calls := 0
	exporter.invoke = func(_ context.Context, args json.RawMessage) (json.RawMessage, error) {
		calls++
		if len(args) != pluginExportMaxBytes {
			t.Errorf("wrong encoded byte boundary: %d", len(args))
		}
		return []byte(`{"protocolVersion":1,"rowCount":1,"text":"ok"}`), nil
	}
	if _, err = exporter.Render(ctx, snapshot); err != nil || calls != 1 {
		t.Fatalf("exact512KiB rejected: %v", err)
	}
	value := *snapshot.Rows[0][3].Value + "x"
	snapshot.Rows[0][3].Value = &value
	calls = 0
	if output, err := exporter.Render(ctx, snapshot); output != nil || err != ErrPluginExportSnapshot || calls != 0 {
		t.Fatal("oversized full envelope crossed RPC boundary")
	}
}
func TestPluginExporterMutableCellDoesNotAliasDispatchedSnapshot(t *testing.T) {
	_, exporter, _ := pluginExporterFixture(t, false)
	ctx := context.Background()
	value := "original"
	snapshot := PluginExportSnapshot{Columns: []string{"x"}, Rows: [][]PluginExportCell{{{Kind: "string", Value: &value}}}}
	exporter.invoke = func(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
		value = "mutated"
		snapshot.Columns[0] = "changed"
		var request pluginExportRequest
		if json.Unmarshal(raw, &request) != nil || request.Columns[0] != "x" || *request.Rows[0][0].Value != "original" {
			t.Error("mutable snapshot reached plugin")
		}
		return []byte(`{"protocolVersion":1,"rowCount":1,"text":"ok"}`), nil
	}
	if _, err := exporter.Render(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
}
