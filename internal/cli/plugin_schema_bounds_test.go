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

func TestPluginCheckSchemaBounds(t *testing.T) {
	schema := func(n int) map[string]any { return map[string]any{"k": strings.Repeat("a", n)} }
	for _, test := range []struct {
		name   string
		schema any
		ok     bool
	}{
		{name: "exact", ok: true, schema: schema((64 << 10) - 8)},
		{name: "over", schema: schema((64 << 10) - 7)},
		{name: "array", schema: []any{}},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{
				"schemaVersion": 1, "apiVersion": 1, "id": "example.schema", "name": "Schema", "version": "1.0.0",
				"permissions": []any{}, "configSchema": test.schema,
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
				t.Fatalf("bounded schema failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), strings.Repeat("a", 80)) || strings.Contains(stderr.String(), source)) {
				t.Fatalf("schema bound: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}
