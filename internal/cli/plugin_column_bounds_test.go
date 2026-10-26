package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPluginCheckColumnByteBounds(t *testing.T) {
	for _, test := range []struct {
		name, key, title string
		ok               bool
	}{
		{name: "exact", ok: true, key: strings.Repeat("中", 42), title: strings.Repeat("中", 85)},
		{name: "key", key: strings.Repeat("中", 43), title: "C"},
		{name: "title", key: "c", title: strings.Repeat("中", 86)},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{
				"schemaVersion": 1, "apiVersion": 1, "id": "example.table", "name": "Table", "version": "1.0.0", "permissions": []any{},
				"contributes": map[string]any{"panels": []any{map[string]any{
					"id": "main", "title": "Panel",
					"body": map[string]any{"type": "table", "columns": []any{map[string]any{"key": test.key, "title": test.title}}, "rows": []any{}},
				}}},
			})
			if err != nil {
				t.Fatal(err)
			}
			source := t.TempDir()
			if err = os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), raw, 0o600); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			var stdout, stderr bytes.Buffer
			code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
			cancel()
			if test.ok && code != ExitSuccess {
				t.Fatalf("bounded column failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), strings.Repeat("中", 40)) || strings.Contains(stderr.String(), source)) {
				t.Fatalf("column bound: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}
