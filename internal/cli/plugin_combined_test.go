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

	"GoNavi-Wails/internal/plugin"
)

func TestPluginCLICombinedPackageEnableDisable(t *testing.T) {
	manifest := plugin.Manifest{SchemaVersion: 1, APIVersion: 1, ID: "example.bundle", Name: "Bundle", Version: "1.0.0",
		Permissions: []string{"data.sources", "ai.skills", "ai.providers", "data.export"},
		Backend:     &plugin.Backend{Default: &plugin.Entry{Executable: "plugin", Runtime: "native"}},
		Contributes: plugin.Contributions{
			Commands:    []plugin.Command{{ID: "db", Title: "DB"}, {ID: "chat", Title: "Chat"}, {ID: "render", Title: "Render"}},
			DataSources: []plugin.DataSource{{ID: "db", Name: "DB", Dialect: "sqlite", Command: "db", ReadOnly: true}},
			Skills:      []plugin.Skill{{ID: "guide", Name: "Guide", Description: "Read", Entry: "skills/guide/SKILL.md", Resources: []string{"skills/guide/NOTES.md"}}},
			AIProviders: []plugin.AIProvider{{ID: "chat", Name: "Chat", Command: "chat", Models: []plugin.AIModel{{ID: "model-a", Name: "Model", ContextWindow: 4096, MaxOutputTokens: 512}}, SupportsTools: true}},
			Exporters:   []plugin.Exporter{{ID: "ndjson", Name: "NDJSON", Command: "render", Extension: "ndjson", ContentType: "application/x-ndjson"}},
		}}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	source := t.TempDir()
	for name, body := range map[string]string{"gonavi.plugin.json": string(raw), "plugin": "not executed", "skills/guide/SKILL.md": "guide", "skills/guide/NOTES.md": "notes"} {
		target := filepath.Join(source, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(target, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	root := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	run := func(args ...string) []byte {
		t.Helper()
		var stdout, stderr bytes.Buffer
		full := append([]string{"--root", root}, args...)
		if code := runPlugin(ctx, full, &stdout, &stderr); code != ExitSuccess {
			t.Fatalf("%v exit=%d stderr=%s", args, code, stderr.String())
		}
		return stdout.Bytes()
	}
	var inspection plugin.Inspection
	if err = json.Unmarshal(run("inspect", source), &inspection); err != nil {
		t.Fatal(err)
	}
	run("install", "--digest", inspection.Digest, "--trust", source)
	assertDesired := func(enabled bool) {
		t.Helper()
		var statuses []plugin.Status
		if err := json.Unmarshal(run("list"), &statuses); err != nil || len(statuses) != 1 || statuses[0].DesiredEnabled != enabled {
			t.Fatalf("desired=%v statuses=%+v err=%v", enabled, statuses, err)
		}
	}
	assertDesired(false)
	run("enable", "example.bundle")
	assertDesired(true)
	run("disable", "example.bundle")
	assertDesired(false)
	run("enable", "example.bundle")
	assertDesired(true)
	var stdout, stderr bytes.Buffer
	if code := runPlugin(ctx, []string{"--root", root, "--safe-mode", "enable", "example.bundle"}, &stdout, &stderr); code != ExitPolicyDenied || !strings.Contains(stderr.String(), "plugin_safe_mode") {
		t.Fatalf("safe-mode enable exit=%d stderr=%s", code, stderr.String())
	}
	stdout.Reset()
	stderr.Reset()
	if code := runPlugin(ctx, []string{"--root", root, "--safe-mode", "disable", "example.bundle"}, &stdout, &stderr); code != ExitSuccess {
		t.Fatalf("safe-mode disable exit=%d stderr=%s", code, stderr.String())
	}
	assertDesired(false)
}
