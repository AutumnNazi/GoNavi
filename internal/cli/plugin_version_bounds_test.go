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

func TestPluginCheckVersionBounds(t *testing.T) {
	for _, test := range []struct {
		name, version, minimum string
		ok                     bool
	}{
		{name: "exact", ok: true, version: "1.2.3-rc.1+build.007", minimum: "1.2.3"},
		{name: "short", version: "1.2", minimum: "1.0.0"},
		{name: "prefix", version: "v1.2.3", minimum: "1.0.0"},
		{name: "zero", version: "01.2.3", minimum: "1.0.0"},
		{name: "pre", version: "1.0.0", minimum: "1.2.3-01"},
		{name: "empty", version: "1.2.3-", minimum: "1.0.0"},
		{name: "build", version: "1.2.3+", minimum: "1.0.0"},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{
				"schemaVersion": 1, "apiVersion": 1, "id": "example.host", "name": "Host", "version": test.version, "permissions": []any{},
				"requires": []any{map[string]any{"id": "example.other", "minVersion": test.minimum}},
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
				t.Fatalf("valid version failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), source)) {
				t.Fatalf("version bound: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}
