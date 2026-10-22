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

func TestPluginCheckIdentityByteBounds(t *testing.T) {
	exact := identityPackage(strings.Repeat("界", 85), strings.Repeat("文", 5461), strings.Repeat("界", 170), strings.Repeat("界", 85))
	for _, test := range []struct {
		name string
		body map[string]any
		leak string
		ok   bool
	}{
		{name: "exact", ok: true, body: exact},
		{name: "name", leak: "界", body: identityPackage(strings.Repeat("界", 86), "Description", "Author", "Apache-2.0")},
		{name: "description", leak: "文", body: identityPackage("Plugin", strings.Repeat("文", 5462), "Author", "Apache-2.0")},
		{name: "author", leak: "界", body: identityPackage("Plugin", "Description", strings.Repeat("界", 171), "Apache-2.0")},
		{name: "license", leak: "界", body: identityPackage("Plugin", "Description", "Author", strings.Repeat("界", 86))},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(test.body)
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
				t.Fatalf("exact identity failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), strings.Repeat(test.leak, 40)) || strings.Contains(stderr.String(), source)) {
				t.Fatalf("overlong identity: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}

func identityPackage(name, description, author, license string) map[string]any {
	return map[string]any{
		"schemaVersion": 1, "apiVersion": 1, "id": "example.identity", "name": name, "version": "1.0.0",
		"description": description, "author": author, "license": license, "permissions": []any{},
	}
}
