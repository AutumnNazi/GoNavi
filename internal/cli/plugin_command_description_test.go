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

func TestPluginCheckCommandDescriptionByteBound(t *testing.T) {
	for _, test := range []struct {
		name  string
		count int
		ok    bool
	}{
		{name: "exact", count: 1365, ok: true},
		{name: "over", count: 1366, ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := writeCommandDescriptionPackage(t, strings.Repeat("文", test.count))
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			var stdout, stderr bytes.Buffer
			code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
			cancel()
			if test.ok && code != ExitSuccess {
				t.Fatalf("bounded description failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), strings.Repeat("文", 40)) || strings.Contains(stderr.String(), source)) {
				t.Fatalf("overlong description: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}

func writeCommandDescriptionPackage(t *testing.T, description string) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"schemaVersion": 1, "apiVersion": 1, "id": "example.commands", "name": "Commands", "version": "1.0.0",
		"permissions": []any{},
		"backend":     map[string]any{"default": map[string]any{"executable": "plugin", "runtime": "native"}},
		"contributes": map[string]any{"commands": []any{map[string]any{"id": "run", "title": "Run", "description": description}}},
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
	return source
}
