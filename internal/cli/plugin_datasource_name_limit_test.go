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

func TestPluginCheckDataSourceNameByteBounds(t *testing.T) {
	for _, test := range []struct {
		name       string
		sourceName string
		ok         bool
	}{
		{name: "exact", sourceName: strings.Repeat("界", 85), ok: true},
		{name: "over", sourceName: strings.Repeat("界", 86), ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{
				"schemaVersion": 1, "apiVersion": 1, "id": "example.source", "name": "Source", "version": "1.0.0",
				"permissions": []string{"data.sources"},
				"backend":     map[string]any{"default": map[string]any{"executable": "plugin", "runtime": "native"}},
				"contributes": map[string]any{
					"commands":    []map[string]any{{"id": "database", "title": "Database", "effect": "read"}},
					"dataSources": []map[string]any{{"id": "fixture", "name": test.sourceName, "dialect": "sqlite", "command": "database", "readOnly": true}},
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			source := t.TempDir()
			for name, content := range map[string][]byte{"gonavi.plugin.json": raw, "plugin": []byte("not executed")} {
				if err = os.WriteFile(filepath.Join(source, name), content, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			var stdout, stderr bytes.Buffer
			code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
			cancel()
			if test.ok && code != ExitSuccess {
				t.Fatalf("exact name failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), strings.Repeat("界", 40)) || strings.Contains(stderr.String(), source)) {
				t.Fatalf("overlong name: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}
