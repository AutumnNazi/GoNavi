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

func TestPluginCheckDependencyCount(t *testing.T) {
	dependencies := make([]map[string]any, 64)
	for i := range dependencies {
		dependencies[i] = map[string]any{"id": fmt.Sprintf("example.dep%d", i)}
	}
	for _, test := range []struct {
		name  string
		items []map[string]any
		ok    bool
	}{
		{name: "exact", items: dependencies, ok: true},
		{name: "over", items: append(append([]map[string]any{}, dependencies...), map[string]any{"id": "example.extra"}), ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{
				"schemaVersion": 1, "apiVersion": 1, "id": "example.host", "name": "Host", "version": "1.0.0",
				"permissions": []any{}, "requires": test.items,
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
				t.Fatalf("64 dependencies failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), source)) {
				t.Fatalf("65 dependencies: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}
