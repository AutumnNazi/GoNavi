package app

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestCompactQueryResultUsesColumnsOnce(t *testing.T) {
	result := connection.QueryResult{
		Success: true,
		Data: []connection.ResultSetData{{
			Columns: []string{"id", "name"},
			Rows: []map[string]interface{}{
				{"id": int64(1), "name": "alpha"},
				{"id": int64(2), "name": nil},
			},
			Messages:       []string{"done"},
			StatementIndex: 2,
			Truncated:      true,
		}},
	}

	compacted := compactQueryResult(result)
	resultSets, ok := compacted.Data.([]compactResultSetData)
	if !ok || len(resultSets) != 1 {
		t.Fatalf("expected one compact result set, got %T %#v", compacted.Data, compacted.Data)
	}
	got := resultSets[0]
	if len(got.RowValues) != 2 || got.RowValues[0][0] != int64(1) || got.RowValues[1][1] != nil {
		t.Fatalf("unexpected compact rows: %#v", got.RowValues)
	}
	if got.StatementIndex != 2 || !got.Truncated || len(got.Messages) != 1 {
		t.Fatalf("result metadata was not preserved: %#v", got)
	}
}

func TestCompactQueryResultKeepsUnknownRowShape(t *testing.T) {
	original := []connection.ResultSetData{{Rows: []map[string]interface{}{{"value": 1}}}}
	result := compactQueryResult(connection.QueryResult{Success: true, Data: original})
	if _, ok := result.Data.([]connection.ResultSetData); !ok {
		t.Fatalf("expected legacy rows when columns are unavailable, got %T", result.Data)
	}
}

func TestEncodeCompactQueryResultCompressesLargeData(t *testing.T) {
	rows := make([]map[string]interface{}, 500)
	for index := range rows {
		rows[index] = map[string]interface{}{
			"id":   index,
			"name": strings.Repeat("repeated-value-", 40),
		}
	}
	result := encodeCompactQueryResult(connection.QueryResult{
		Success:    true,
		DurationMs: 123,
		QueryID:    "query-1",
		Data: []connection.ResultSetData{{
			Columns: []string{"id", "name"},
			Rows:    rows,
		}},
	})

	if result.DataEncoding != compactQueryResultEncoding || len(result.EncodedData) == 0 {
		t.Fatalf("expected compressed result, got encoding=%q bytes=%d", result.DataEncoding, len(result.EncodedData))
	}
	if result.Data != nil {
		t.Fatalf("compressed result retained raw data: %T", result.Data)
	}
	wire, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal compressed response: %v", err)
	}
	if !bytes.Contains(wire, []byte(`"durationMs":123`)) ||
		!bytes.Contains(wire, []byte(`"queryId":"query-1"`)) ||
		bytes.Contains(wire, []byte(`"QueryResult"`)) {
		t.Fatalf("query result metadata was not flattened: %s", wire)
	}
	reader, err := gzip.NewReader(bytes.NewReader(result.EncodedData))
	if err != nil {
		t.Fatalf("open compressed result: %v", err)
	}
	decoded, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read compressed result: %v", err)
	}
	if err := reader.Close(); err != nil {
		t.Fatalf("close compressed result: %v", err)
	}
	var resultSets []compactResultSetData
	if err := json.Unmarshal(decoded, &resultSets); err != nil {
		t.Fatalf("decode compressed result: %v", err)
	}
	if len(resultSets) != 1 || len(resultSets[0].RowValues) != len(rows) {
		t.Fatalf("unexpected decoded result sets: %#v", resultSets)
	}
}

func TestCompactQueryResultExposesQueryID(t *testing.T) {
	compact := encodeCompactQueryResult(connection.QueryResult{
		Success: true,
		QueryID: "query-compact-1",
	})

	if got := compact.QueryResultQueryID(); got != "query-compact-1" {
		t.Fatalf("QueryResultQueryID() = %q, want %q", got, "query-compact-1")
	}
}
