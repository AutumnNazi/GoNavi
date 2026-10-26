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

func TestPluginCheckCommandEffects(t *testing.T) {
	for _, test := range []struct {
		name, effect string
		source       bool
		ok           bool
	}{
		{name: "write", ok: true, effect: "write"},
		{name: "upper", effect: "WRITE"},
		{name: "alias", effect: "sideeffect"},
		{name: "data", effect: "write", source: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			contributes := map[string]any{"commands": []any{map[string]any{"id": "query", "title": "Query", "effect": test.effect}}}
			if test.source {
				contributes["dataSources"] = []any{map[string]any{"id": "db", "name": "DB", "dialect": "sqlite", "command": "query", "readOnly": true}}
			}
			raw, err := json.Marshal(map[string]any{
				"schemaVersion": 1, "apiVersion": 1, "id": "example.host", "name": "Host", "version": "1.0.0", "permissions": []any{},
				"backend":     map[string]any{"default": map[string]any{"executable": "plugin", "runtime": "native"}},
				"contributes": contributes,
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
				t.Fatalf("write command failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), source)) {
				t.Fatalf("effect: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}
