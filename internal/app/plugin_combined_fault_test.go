package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginSetEnabledDisablesFaultedCombinedPackage(t *testing.T) {
	a := newPluginTestApp(t)
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
	inspected := a.PluginInspect(source)
	if !inspected.Success {
		t.Fatalf("inspect: %+v", inspected)
	}
	snapshot := inspected.Data.(plugin.Inspection)
	if result := a.PluginInstall(source, snapshot.Digest, true); !result.Success {
		t.Fatalf("install: %+v", result)
	}
	if result := a.PluginSetEnabled("example.bundle", true); !result.Success {
		t.Fatalf("enable: %+v", result)
	}
	deadline := time.Now().Add(5 * time.Second)
	var faulted bool
	for time.Now().Before(deadline) {
		list := a.PluginList()
		if !list.Success {
			t.Fatalf("list during fault: %+v", list)
		}
		statuses := list.Data.([]plugin.Status)
		if len(statuses) == 1 && statuses[0].State == plugin.StateFaulted {
			faulted = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !faulted {
		t.Fatal("combined package did not fault")
	}
	if result := a.PluginSetEnabled("example.bundle", false); !result.Success {
		t.Fatalf("disable: %+v", result)
	}
	list := a.PluginList()
	if !list.Success {
		t.Fatalf("list after disable: %+v", list)
	}
	statuses := list.Data.([]plugin.Status)
	if len(statuses) != 1 || statuses[0].DesiredEnabled {
		t.Fatalf("desktop management could not disable the faulted plugin: %+v", statuses)
	}
	if result := a.PluginSetEnabled("example.bundle", true); !result.Success {
		t.Fatalf("reenable: %+v", result)
	}
	list = a.PluginList()
	if !list.Success {
		t.Fatalf("list after reenable: %+v", list)
	}
	statuses = list.Data.([]plugin.Status)
	if len(statuses) != 1 || !statuses[0].DesiredEnabled {
		t.Fatalf("desktop management could not enable the plugin again: %+v", statuses)
	}
}
