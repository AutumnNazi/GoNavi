package app

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginSkillsEmptyCatalogDoesNotStart(t *testing.T) {
	a := newPluginTestApp(t)
	ConfigurePluginWindows(a, func(context.Context, *plugin.Manager) (PluginWindowHost, error) {
		t.Fatal("discovery initialized the window runtime")
		return nil, nil
	})
	catalog := pluginSkillCatalogResult(t, a.PluginSkills())
	raw, err := json.Marshal(catalog)
	if err != nil || string(raw) != `{"items":[]}` {
		t.Fatalf("empty catalog must be an array: %s %v", raw, err)
	}
	if _, err := PluginSkillManagerForIntegration(a.ctx, a); err == nil {
		t.Fatal("integration discovery initialized execution")
	}
	requirePluginSkillNoStartup(t, a)
}

func TestPluginSkillsDisabledMetadataDoesNotLoadBody(t *testing.T) {
	fixture := newPluginSkillFixture(t)
	a := fixture.app
	catalog := pluginSkillCatalogResult(t, a.PluginSkills())
	if len(catalog.Items) != 1 {
		t.Fatalf("disabled skills missing: %d", len(catalog.Items))
	}
	item := catalog.Items[0]
	skill := fixture.inspection.Manifest.Contributes.Skills[0]
	if item.PluginID != fixture.inspection.Manifest.ID || item.ID != skill.ID || item.Name != skill.Name ||
		item.Description != skill.Description || item.Entry != skill.Entry || item.Version != fixture.inspection.Manifest.Version ||
		item.Digest != fixture.inspection.Digest || item.Generation == 0 || item.Available || item.Reason != "disabled" {
		t.Fatalf("disabled skill metadata: %+v", item)
	}
	raw, err := json.Marshal(catalog)
	if err != nil || strings.Contains(string(raw), "content") || strings.Contains(string(raw), pluginSkillTestBody) {
		t.Fatal("metadata catalog exposed skill content")
	}
	// Missing installed bodies must not affect persisted metadata discovery.
	if err := os.Remove(fixture.bodyPath); err != nil {
		t.Fatal(err)
	}
	again := pluginSkillCatalogResult(t, a.PluginSkills())
	repeat, err := json.Marshal(again)
	if err != nil || string(repeat) != string(raw) {
		t.Fatal("metadata discovery consulted a packaged document")
	}
	requirePluginSkillFailure(t, a.PluginSkillRead(item.PluginID, item.ID, item.Digest, item.Generation), "runtime_unavailable")
	requirePluginSkillNoStartup(t, a)
}

func TestPluginSkillsEnabledColdCatalogDoesNotStart(t *testing.T) {
	fixture := newPluginSkillFixture(t)
	if _, err := fixture.manager.SetEnabled(fixture.app.ctx, fixture.inspection.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	catalog := pluginSkillCatalogResult(t, fixture.app.PluginSkills())
	if len(catalog.Items) != 1 || catalog.Items[0].Available || catalog.Items[0].Reason != "starting" {
		t.Fatal("cold enabled metadata advertised an active skill")
	}
	item := catalog.Items[0]
	requirePluginSkillFailure(t, fixture.app.PluginSkillRead(item.PluginID, item.ID, item.Digest, item.Generation), "runtime_unavailable")
	if fixture.manager.OwnsRuntime() {
		t.Fatal("discovery started the metadata controller")
	}
	requirePluginSkillNoStartup(t, fixture.app)
}

func TestPluginSkillViewsAvailabilityAndReasons(t *testing.T) {
	for _, tt := range []struct {
		name            string
		state           plugin.State
		enabled, owned  bool
		safe, available bool
		generation      uint64
		reason          string
	}{
		{name: "running locally", state: plugin.StateRunning, enabled: true, owned: true, generation: 7, available: true},
		{name: "running elsewhere", state: plugin.StateRunning, enabled: true, generation: 7, reason: "runtime_unavailable"},
		{name: "zero generation", state: plugin.StateRunning, enabled: true, owned: true, reason: "runtime_unavailable"},
		{name: "disabled", state: plugin.StateRunning, owned: true, generation: 7, reason: "disabled"},
		{name: "cold enabled", state: plugin.StateDisabled, enabled: true, owned: true, generation: 7, reason: "runtime_unavailable"},
		{name: "starting", state: plugin.StateStarting, enabled: true, owned: true, generation: 7, reason: "starting"},
		{name: "stopping", state: plugin.StateStopping, enabled: true, owned: true, generation: 7, reason: "stopping"},
		{name: "faulted", state: plugin.StateFaulted, enabled: true, owned: true, generation: 7, reason: "faulted"},
		{name: "blocked", state: plugin.StateBlocked, enabled: true, owned: true, generation: 7, reason: "blocked"},
		{name: "unknown", state: plugin.State("unknown"), enabled: true, owned: true, generation: 7, reason: "runtime_unavailable"},
		{name: "safe mode", state: plugin.StateRunning, enabled: true, owned: true, safe: true, generation: 7, reason: "safe_mode"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			status := plugin.Status{Manifest: pluginSkillTestManifest(), Digest: strings.Repeat("a", 64),
				State: tt.state, DesiredEnabled: tt.enabled, Generation: tt.generation, LastError: "untrusted-path-or-error"}
			items := pluginSkillViews([]plugin.Status{status}, tt.safe, tt.owned)
			if len(items) != 1 || items[0].Available != tt.available || items[0].Reason != tt.reason || items[0].Generation != tt.generation {
				t.Fatalf("skill availability: %+v", items)
			}
		})
	}
}

func TestPluginSkillViewsPermissionPrecisionAndOrdering(t *testing.T) {
	status := plugin.Status{Manifest: pluginSkillTestManifest(), Generation: maxPluginSkillGeneration, State: plugin.StateRunning, DesiredEnabled: true}
	for _, permissions := range [][]string{nil, {"ai"}, {"ai.skills.read"}, {"AI.skills"}} {
		status.Manifest.Permissions = permissions
		if items := pluginSkillViews([]plugin.Status{status}, false, true); len(items) != 0 {
			t.Fatalf("implicit skill permission accepted: %v", permissions)
		}
	}
	status.Manifest.Permissions = []string{"ai.skills"}
	if items := pluginSkillViews([]plugin.Status{status}, false, true); len(items) != 1 || !items[0].Available {
		t.Fatal("exact maximum JS generation was omitted")
	}
	status.Generation++
	if items := pluginSkillViews([]plugin.Status{status}, false, true); len(items) != 0 {
		t.Fatal("inexact JS generation was advertised")
	}
	status.Generation = 7
	second := plugin.Status{Manifest: pluginSkillTestManifest(), Generation: 8}
	second.Manifest.ID = "alpha.skills"
	second.Manifest.Contributes.Skills = []plugin.Skill{{ID: "z-last"}, {ID: "a-first"}}
	items := pluginSkillViews([]plugin.Status{status, second}, false, false)
	if len(items) != 3 || items[0].PluginID != "alpha.skills" || items[0].ID != "a-first" || items[1].ID != "z-last" || items[2].PluginID != status.Manifest.ID {
		t.Fatalf("nondeterministic skill ordering: %+v", items)
	}
}
