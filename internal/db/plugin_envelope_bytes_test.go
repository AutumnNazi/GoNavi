package db

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestPluginDatabaseEnvelopeByteBound(t *testing.T) {
	text := strings.Repeat("文", 80000)
	if len(text) > pluginDatabaseMaxQuery {
		t.Fatal("cell fixture exceeds its own limit")
	}
	rows := make([]map[string]string, 4)
	for i := range rows {
		rows[i] = map[string]string{"id": text}
	}
	payload, err := json.Marshal(map[string]any{"fields": []string{"id"}, "rows": rows})
	if err != nil || len(payload) > pluginDatabaseMaxJSON {
		t.Fatalf("under fixture: %d %v", len(payload), err)
	}
	if _, _, err = decodePluginQuery(json.RawMessage(payload)); err != nil {
		t.Fatal(err)
	}
	rows = append(rows, map[string]string{"id": text})
	over, err := json.Marshal(map[string]any{"fields": []string{"id"}, "rows": rows})
	if err != nil || len(over) <= pluginDatabaseMaxJSON {
		t.Fatalf("over fixture: %d %v", len(over), err)
	}
	if _, fields, err := decodePluginQuery(json.RawMessage(over)); !errors.Is(err, ErrPluginDatabaseProtocol) || fields != nil {
		t.Fatal(err)
	}
}
