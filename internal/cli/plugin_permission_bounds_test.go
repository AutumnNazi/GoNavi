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

func TestPluginCheckPermissionBounds(t *testing.T) {
	permissions := make([]string, 64)
	for i := range permissions {
		permissions[i] = fmt.Sprintf("perm.%d", i)
	}
	for _, test := range []struct {
		name  string
		perms []string
		note  string
		ok    bool
	}{
		{name: "exact", perms: permissions, note: strings.Repeat("界", 53), ok: true},
		{name: "count", perms: append(append([]string{}, permissions...), "perm.64"), note: "short", ok: false},
		{name: "note", perms: permissions, note: strings.Repeat("界", 54), ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{
				"schemaVersion": 1, "apiVersion": 1, "id": "example.notes", "name": "Notes", "version": "1.0.0",
				"permissions": test.perms, "permissionNotes": map[string]string{"perm.0": test.note},
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
				t.Fatalf("bounded permissions failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), strings.Repeat("界", 40)) || strings.Contains(stderr.String(), source)) {
				t.Fatalf("permission bound: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}
