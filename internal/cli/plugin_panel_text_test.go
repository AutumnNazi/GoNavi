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

func TestPluginCheckPanelTextByteBounds(t *testing.T) {
	for _, test := range []struct {
		name, title, nodeTitle, text, leak string
		ok                                 bool
	}{
		{name: "exact", ok: true, title: strings.Repeat("中", 85), nodeTitle: strings.Repeat("中", 341), text: strings.Repeat("文", 5461)},
		{name: "text", leak: "文", title: "Panel", nodeTitle: "Title", text: strings.Repeat("文", 5462)},
		{name: "node", leak: "中", title: "Panel", nodeTitle: strings.Repeat("中", 342), text: "ok"},
		{name: "title", leak: "中", title: strings.Repeat("中", 86), nodeTitle: "Title", text: "ok"},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{
				"schemaVersion": 1, "apiVersion": 1, "id": "example.panel", "name": "Panel", "version": "1.0.0", "permissions": []any{},
				"contributes": map[string]any{"panels": []any{map[string]any{
					"id": "main", "title": test.title, "body": map[string]any{"type": "text", "title": test.nodeTitle, "text": test.text},
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
				t.Fatalf("bounded panel failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), strings.Repeat(test.leak, 40)) || strings.Contains(stderr.String(), source)) {
				t.Fatalf("overlong panel: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}
