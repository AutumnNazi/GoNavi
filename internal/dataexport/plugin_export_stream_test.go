package dataexport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestStreamPluginExportRendersOrderedChunks(t *testing.T) {
	_, exporter, _ := pluginExporterFixture(t, false)
	data := make([]map[string]any, 1200)
	for index := range data {
		data[index] = map[string]any{"id": index, "name": fmt.Sprintf("row-%d", index)}
	}
	var indices []int
	exporter.invoke = func(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var request pluginExportChunkRequest
		if err := json.Unmarshal(raw, &request); err != nil || request.ProtocolVersion != 2 {
			return nil, fmt.Errorf("invalid chunk request")
		}
		indices = append(indices, request.ChunkIndex)
		return json.Marshal(map[string]any{"protocolVersion": 2, "exporterId": request.ExporterID, "chunkIndex": request.ChunkIndex, "rowCount": len(request.Rows), "text": fmt.Sprintf("[%d:%d]", request.ChunkIndex, len(request.Rows))})
	}
	var output bytes.Buffer
	var progress []int64
	stream, err := PreparePluginExportStream(context.Background(), data, []string{"id", "name"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := StreamPluginExport(context.Background(), exporter, stream, func(chunk []byte) error {
		_, writeErr := output.Write(chunk)
		return writeErr
	}, func(current int64) { progress = append(progress, current) })
	if err != nil || rows != 1200 {
		t.Fatalf("stream failed: rows=%d err=%v", rows, err)
	}
	if len(indices) != 3 || indices[0] != 0 || indices[1] != 1 || indices[2] != 2 {
		t.Fatalf("chunk order: %v", indices)
	}
	if output.String() != "[0:512][1:512][2:176]" {
		t.Fatalf("chunk text: %q", output.String())
	}
	if len(progress) != 3 || progress[2] != 1200 {
		t.Fatalf("progress: %v", progress)
	}
}

func TestStreamPluginExportRendersOneEmptyChunkForZeroRows(t *testing.T) {
	_, exporter, _ := pluginExporterFixture(t, false)
	var requests []pluginExportChunkRequest
	exporter.invoke = func(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var request pluginExportChunkRequest
		if err := json.Unmarshal(raw, &request); err != nil {
			return nil, err
		}
		requests = append(requests, request)
		return json.Marshal(map[string]any{"protocolVersion": 2, "exporterId": request.ExporterID, "chunkIndex": request.ChunkIndex, "rowCount": len(request.Rows), "text": "header\n"})
	}
	var output bytes.Buffer
	stream, err := PreparePluginExportStream(context.Background(), nil, []string{"id"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := StreamPluginExport(context.Background(), exporter, stream, func(chunk []byte) error {
		_, writeErr := output.Write(chunk)
		return writeErr
	}, nil)
	if err != nil || rows != 0 || output.String() != "header\n" {
		t.Fatalf("empty stream: rows=%d output=%q err=%v", rows, output.String(), err)
	}
	if len(requests) != 1 || requests[0].ChunkIndex != 0 || requests[0].ChunkCount != 1 || len(requests[0].Rows) != 0 {
		t.Fatalf("empty chunk request: %+v", requests)
	}
}

func TestStreamPluginExportRejectsOversizedChunk(t *testing.T) {
	_, exporter, _ := pluginExporterFixture(t, false)
	calls := 0
	exporter.invoke = func(context.Context, json.RawMessage) (json.RawMessage, error) {
		calls++
		return nil, fmt.Errorf("must not run")
	}
	value := strings.Repeat("x", pluginExportCellBytes)
	data := []map[string]any{{"a": value, "b": value, "c": value, "d": value, "e": value}}
	if _, err := PreparePluginExportStream(context.Background(), data, []string{"a", "b", "c", "d", "e"}, nil); err != ErrPluginExportSnapshot {
		t.Fatalf("oversized row accepted: %v", err)
	}
	if calls != 0 {
		t.Fatalf("oversized row reached plugin: %d", calls)
	}
}

func TestPluginExportChunkReplyStrictness(t *testing.T) {
	valid := `{"protocolVersion":2,"exporterId":"ndjson","chunkIndex":1,"rowCount":2,"text":"ok"}`
	if _, err := pluginExportChunkReply(context.Background(), []byte(valid), "ndjson", 1, 2); err != nil {
		t.Fatalf("valid chunk reply: %v", err)
	}
	for _, value := range []string{
		`{"protocolVersion":1,"exporterId":"ndjson","chunkIndex":1,"rowCount":2,"text":"ok"}`,
		`{"protocolVersion":2,"exporterId":"other","chunkIndex":1,"rowCount":2,"text":"ok"}`,
		`{"protocolVersion":2,"exporterId":"ndjson","chunkIndex":0,"rowCount":2,"text":"ok"}`,
		`{"protocolVersion":2,"exporterId":"ndjson","chunkIndex":1,"rowCount":3,"text":"ok"}`,
		`{"protocolVersion":2,"exporterId":"ndjson","chunkIndex":1,"rowCount":2}`,
	} {
		if _, err := pluginExportChunkReply(context.Background(), []byte(value), "ndjson", 1, 2); err != ErrPluginExportRender {
			t.Fatalf("accepted %s: %v", value, err)
		}
	}
}
