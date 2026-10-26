package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectPermissionBounds(t *testing.T) {
	a := newPluginTestApp(t)
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
			raw, err := json.Marshal(plugin.Manifest{
				SchemaVersion: 1, APIVersion: 1, ID: "example.notes", Name: "Notes", Version: "1.0.0",
				Permissions: test.perms, PermissionNotes: map[string]string{"perm.0": test.note},
			})
			if err != nil {
				t.Fatal(err)
			}
			source := t.TempDir()
			if err = os.WriteFile(filepath.Join(source, "gonavi.plugin.json"), raw, 0o600); err != nil {
				t.Fatal(err)
			}
			result := a.PluginInspect(source)
			if test.ok && !result.Success {
				t.Fatalf("bounded permissions rejected: %+v", result)
			}
			if !test.ok && (result.Success || strings.Contains(result.Message, strings.Repeat("界", 40)) || strings.Contains(result.Message, source)) {
				t.Fatalf("permission bound: %+v", result)
			}
		})
	}
}
