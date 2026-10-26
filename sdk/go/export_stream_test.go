package plugin

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func exportStreamTestChunk(t *testing.T, index, count int, rows int) ExporterSnapshot {
	t.Helper()
	cells := make([][]ExporterCell, rows)
	for row := range cells {
		value := "x"
		cells[row] = []ExporterCell{{Kind: ExporterString, Value: &value}}
	}
	return ExporterSnapshot{Columns: []string{"a"}, Rows: cells, ProtocolVersion: 2, ChunkIndex: index, ChunkCount: count}
}

func TestExporterStreamingDispatcherObservesChunkIdentity(t *testing.T) {
	var seen ExporterSnapshot
	dispatcher, err := NewExporterDispatcher(map[string]ExporterRender{"ndjson": func(_ context.Context, snapshot ExporterSnapshot) (string, error) {
		seen = snapshot
		return "chunk-text", nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := EncodeExporterChunkRequest(context.Background(), "ndjson", exportStreamTestChunk(t, 1, 3, 2))
	if err != nil {
		t.Fatal(err)
	}
	value, err := dispatcher.Handle(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	result, ok := value.(ExporterChunkResult)
	if !ok || result.ProtocolVersion != 2 || result.ExporterID != "ndjson" || result.ChunkIndex != 1 || result.RowCount != 2 || result.Text != "chunk-text" {
		t.Fatalf("chunk result: %#v", value)
	}
	if seen.ProtocolVersion != 2 || seen.ChunkIndex != 1 || seen.ChunkCount != 3 || len(seen.Rows) != 2 {
		t.Fatalf("renderer snapshot: %#v", seen)
	}
	encoded, err := json.Marshal(value)
	if err != nil || !strings.Contains(string(encoded), `"chunkIndex":1`) || strings.Contains(string(encoded), `"filename"`) {
		t.Fatalf("chunk wire result: %s %v", encoded, err)
	}
}

func TestExporterStreamingEnvelopeBounds(t *testing.T) {
	if _, err := EncodeExporterChunkRequest(context.Background(), "ndjson", exportStreamTestChunk(t, 0, 1, ExporterChunkRows+1)); err == nil {
		t.Fatal("chunk over row budget accepted")
	}
	valid, err := EncodeExporterChunkRequest(context.Background(), "ndjson", exportStreamTestChunk(t, 0, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	for _, broken := range []string{
		strings.Replace(string(valid), `"chunkIndex":0`, `"chunkIndex":1`, 1),
		strings.Replace(string(valid), `"chunkCount":1`, `"chunkCount":0`, 1),
		strings.Replace(string(valid), `"protocolVersion":2`, `"protocolVersion":1`, 1),
		strings.Replace(string(valid), `"chunkCount":1`, `"chunkCount":1,"chunkIndex":0`, 1),
		strings.Replace(string(valid), `"exporterId":"ndjson",`, ``, 1),
	} {
		if _, err := decodeExporterRequest(context.Background(), json.RawMessage(broken)); err == nil {
			t.Fatalf("invalid chunk envelope accepted: %s", broken)
		}
	}
}
