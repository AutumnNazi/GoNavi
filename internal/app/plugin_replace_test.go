package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func copyExampleSkills(t *testing.T, directory, version string) {
	t.Helper()
	source := filepath.Join("..", "..", "examples", "plugins", "skills")
	for _, name := range []string{"gonavi.plugin.json", "skills/read-only-investigation/SKILL.md", "skills/read-only-investigation/REFERENCE.md"} {
		body, err := os.ReadFile(filepath.Join(source, filepath.FromSlash(name)))
		if err != nil {
			t.Fatal(err)
		}
		if name == "gonavi.plugin.json" {
			body = []byte(strings.Replace(string(body), `"version": "1.0.0"`, `"version": "`+version+`"`, 1))
		}
		target := filepath.Join(directory, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPluginReplaceKeepsEnabledDesktopPlugin(t *testing.T) {
	a := newPluginTestApp(t)
	first := t.TempDir()
	copyExampleSkills(t, first, "1.0.0")
	inspected := a.PluginInspect(first)
	if !inspected.Success {
		t.Fatalf("inspect: %+v", inspected)
	}
	if result := a.PluginInstall(first, inspected.Data.(plugin.Inspection).Digest, true); !result.Success {
		t.Fatalf("install: %+v", result)
	}
	if result := a.PluginSetEnabled("sdk.examples.skills", true); !result.Success {
		t.Fatalf("enable: %+v", result)
	}
	second := t.TempDir()
	copyExampleSkills(t, second, "2.0.0")
	next := a.PluginInspect(second)
	if !next.Success {
		t.Fatalf("inspect: %+v", next)
	}
	replaced := a.PluginReplace(second, next.Data.(plugin.Inspection).Digest, true)
	if !replaced.Success {
		t.Fatalf("replace: %+v", replaced)
	}
	status, ok := replaced.Data.(plugin.Status)
	if !ok || status.Manifest.Version != "2.0.0" || !status.DesiredEnabled {
		t.Fatalf("status: %+v", replaced.Data)
	}
	listed := a.PluginList()
	statuses, ok := listed.Data.([]plugin.Status)
	if !listed.Success || !ok || len(statuses) != 1 || statuses[0].Manifest.Version != "2.0.0" || !statuses[0].DesiredEnabled {
		t.Fatalf("list: %+v", listed.Data)
	}
}
