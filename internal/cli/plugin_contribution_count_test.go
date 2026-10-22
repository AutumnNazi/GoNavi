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

func TestPluginCheckContributionCounts(t *testing.T) {
	for _, test := range []struct {
		name     string
		commands int
		panels   int
		ok       bool
	}{
		{name: "exact", commands: 128, panels: 32, ok: true},
		{name: "commands", commands: 129, panels: 0, ok: false},
		{name: "panels", commands: 0, panels: 33, ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := writeContributionPackage(t, test.commands, test.panels)
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			var stdout, stderr bytes.Buffer
			code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", source}, &stdout, &stderr)
			cancel()
			if test.ok && code != ExitSuccess {
				t.Fatalf("bounded contributions failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), source)) {
				t.Fatalf("count: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}

func writeContributionPackage(t *testing.T, commandCount, panelCount int) string {
	t.Helper()
	commands := make([]map[string]any, commandCount)
	for i := range commands {
		commands[i] = map[string]any{"id": fmt.Sprintf("cmd%d", i), "title": "Run"}
	}
	panels := make([]map[string]any, panelCount)
	for i := range panels {
		panels[i] = map[string]any{"id": fmt.Sprintf("panel%d", i), "title": "Panel", "body": map[string]any{"type": "text", "text": "Status"}}
	}
	raw, err := json.Marshal(map[string]any{
		"schemaVersion": 1, "apiVersion": 1, "id": "example.counts", "name": "Counts", "version": "1.0.0",
		"permissions": []any{},
		"backend":     map[string]any{"default": map[string]any{"executable": "plugin", "runtime": "native"}},
		"contributes": map[string]any{"commands": commands, "panels": panels},
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
