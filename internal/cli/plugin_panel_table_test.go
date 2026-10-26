package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPluginCheckPanelTableCounts(t *testing.T) {
	for _, test := range []struct {
		name          string
		columns, rows int
		children      int
		ok            bool
	}{
		{name: "exact", columns: 32, rows: 500, ok: true},
		{name: "columns", columns: 33, rows: 0, ok: false},
		{name: "rows", columns: 1, rows: 501, ok: false},
		{name: "children", children: 129, ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := writePanelTablePackage(t, test.columns, test.rows, test.children)
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			var stdout, stderr bytes.Buffer
			code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
			cancel()
			if test.ok && code != ExitSuccess {
				t.Fatalf("bounded table failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), source)) {
				t.Fatalf("table count: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}

func writePanelTablePackage(t *testing.T, columnCount, rowCount, childCount int) string {
	t.Helper()
	var body map[string]any
	if childCount > 0 {
		children := make([]any, childCount)
		for i := range children {
			children[i] = map[string]any{"type": "text", "text": "x"}
		}
		body = map[string]any{"type": "column", "children": children}
	} else {
		columns := make([]any, columnCount)
		for i := range columns {
			columns[i] = map[string]any{"key": fmt.Sprintf("c%d", i), "title": "C"}
		}
		rows := make([]any, rowCount)
		for i := range rows {
			rows[i] = map[string]any{}
		}
		body = map[string]any{"type": "table", "columns": columns, "rows": rows}
	}
	raw, err := json.Marshal(map[string]any{
		"schemaVersion": 1, "apiVersion": 1, "id": "example.table", "name": "Table", "version": "1.0.0", "permissions": []any{},
		"contributes": map[string]any{"panels": []any{map[string]any{"id": "main", "title": "Panel", "body": body}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	source := t.TempDir()
	if err = os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	return source
}
