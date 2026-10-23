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

func TestPluginCheckContributionNameByteBounds(t *testing.T) {
	exact := strings.Repeat("界", 85)
	over := strings.Repeat("界", 86)
	for _, test := range []struct {
		name string
		ok   bool
		body map[string]any
	}{
		{name: "exporter exact", ok: true, body: exporterPackage(exact)},
		{name: "exporter over", ok: false, body: exporterPackage(over)},
		{name: "provider exact", ok: true, body: providerPackage(exact, "Model")},
		{name: "provider over", ok: false, body: providerPackage(over, "Model")},
		{name: "model over", ok: false, body: providerPackage("Chat", over)},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(test.body)
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
				t.Fatalf("exact name failed: %s", stderr.String())
			}
			if !test.ok && (code == ExitSuccess || strings.Contains(stderr.String(), strings.Repeat("界", 40)) || strings.Contains(stderr.String(), source)) {
				t.Fatalf("overlong name: exit=%d stderr=%s", code, stderr.String())
			}
		})
	}
}

func exporterPackage(name string) map[string]any {
	return map[string]any{
		"schemaVersion": 1, "apiVersion": 1, "id": "example.export", "name": "Export", "version": "1.0.0",
		"permissions": []string{"data.export"},
		"backend":     map[string]any{"default": map[string]any{"executable": "plugin", "runtime": "native"}},
		"contributes": map[string]any{
			"commands":  []map[string]any{{"id": "render", "title": "Render", "effect": "read"}},
			"exporters": []map[string]any{{"id": "ndjson", "name": name, "command": "render", "extension": "ndjson", "contentType": "application/x-ndjson"}},
		},
	}
}

func providerPackage(name, model string) map[string]any {
	return map[string]any{
		"schemaVersion": 1, "apiVersion": 1, "id": "example.ai", "name": "AI", "version": "1.0.0",
		"permissions": []string{"ai.providers"},
		"backend":     map[string]any{"default": map[string]any{"executable": "plugin", "runtime": "native"}},
		"contributes": map[string]any{
			"commands": []map[string]any{{"id": "generate", "title": "Generate"}},
			"aiProviders": []map[string]any{{
				"id": "chat", "name": name, "command": "generate", "supportsTools": true, "supportsImages": false,
				"models": []map[string]any{{"id": "model", "name": model, "contextWindow": 4096, "maxOutputTokens": 512}},
			}},
		},
	}
}
