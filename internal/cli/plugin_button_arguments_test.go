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

func TestPluginCheckButtonArgumentBounds(t *testing.T) {
	for _, test := range []struct {
		name string
		n    int
		ok   bool
	}{
		{name: "exact", n: (64 << 10) - 8, ok: true},
		{name: "over", n: (64 << 10) - 7},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{
				"schemaVersion": 1, "apiVersion": 1, "id": "example.button", "name": "Button", "version": "1.0.0", "permissions": []any{},
				"backend": map[string]any{"default": map[string]any{"executable": "plugin", "runtime": "native"}},
				"contributes": map[string]any{
					"commands": []any{map[string]any{"id": "run", "title": "Run"}},
					"panels":   []any{map[string]any{"id": "main", "title": "Panel", "body": map[string]any{"type": "button", "command": "run", "arguments": map[string]any{"k": strings.Repeat("a", test.n)}}}},
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
				t.Fatalf("bounded arguments failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), strings.Repeat("a", 80)) || strings.Contains(stderr.String(), source)) {
				t.Fatalf("argument bound: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}
