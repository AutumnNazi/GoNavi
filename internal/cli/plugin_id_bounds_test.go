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

func TestPluginCheckIDBounds(t *testing.T) {
	longID := "example." + strings.Repeat("a", 121)
	for _, test := range []struct {
		name, id string
		deps     []string
		ok       bool
	}{
		{name: "exact", ok: true, id: "example.plugin"},
		{name: "case", id: "Example.plugin"},
		{name: "hyphen", id: "example.plugin-"},
		{name: "length", id: longID},
		{name: "self", id: "example.host", deps: []string{"example.host"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := map[string]any{
				"schemaVersion": 1, "apiVersion": 1, "id": test.id, "name": "Identity", "version": "1.0.0", "permissions": []any{},
			}
			if test.deps != nil {
				requires := make([]map[string]any, len(test.deps))
				for i, id := range test.deps {
					requires[i] = map[string]any{"id": id}
				}
				body["requires"] = requires
			}
			raw, err := json.Marshal(body)
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
				t.Fatalf("valid id failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), strings.Repeat("a", 40)) || strings.Contains(stderr.String(), source)) {
				t.Fatalf("id bound: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}
