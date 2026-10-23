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

func TestPluginCheckLocalIDBounds(t *testing.T) {
	for _, test := range []struct {
		name string
		ids  []string
		ok   bool
	}{
		{name: "exact", ok: true, ids: []string{"run.now_1-A"}},
		{name: "hyphen", ids: []string{"-run"}},
		{name: "slash", ids: []string{"run/now"}},
		{name: "space", ids: []string{"run now"}},
		{name: "length", ids: []string{strings.Repeat("a", 129)}},
		{name: "duplicate", ids: []string{"run", "run"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			commands := make([]map[string]any, len(test.ids))
			for i, id := range test.ids {
				commands[i] = map[string]any{"id": id, "title": "Run"}
			}
			raw, err := json.Marshal(map[string]any{
				"schemaVersion": 1, "apiVersion": 1, "id": "example.host", "name": "Host", "version": "1.0.0", "permissions": []any{},
				"backend":     map[string]any{"default": map[string]any{"executable": "plugin", "runtime": "native"}},
				"contributes": map[string]any{"commands": commands},
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
				t.Fatalf("valid local id failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), strings.Repeat("a", 40)) || strings.Contains(stderr.String(), source)) {
				t.Fatalf("local id: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}
