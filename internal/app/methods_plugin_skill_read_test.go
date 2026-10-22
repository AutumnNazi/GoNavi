package app

import (
	"os"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/plugin"
)

func requirePluginSkillContent(t *testing.T, result connection.QueryResult, fixture pluginSkillFixture, status plugin.Status) {
	t.Helper()
	value, ok := result.Data.(plugin.SkillContent)
	skill := fixture.inspection.Manifest.Contributes.Skills[0]
	if !result.Success || !ok || value.PluginID != status.Manifest.ID || value.SkillID != skill.ID ||
		value.Name != skill.Name || value.Description != skill.Description || value.Version != status.Manifest.Version ||
		value.Digest != status.Digest || value.Generation != status.Generation || value.Content != pluginSkillTestBody {
		t.Fatalf("skill preview lost content or provenance: success=%t type=%T", result.Success, result.Data)
	}
}

func TestPluginSkillReadOwnedStaticLifecycleFencesSnapshots(t *testing.T) {
	fixture := newPluginSkillFixture(t)
	a := fixture.app
	status := startPluginSkillFixture(t, fixture)
	skillID := fixture.inspection.Manifest.Contributes.Skills[0].ID
	manager, err := PluginSkillManagerForIntegration(a.ctx, a)
	if err != nil || manager != fixture.manager {
		t.Fatalf("existing execution owner unavailable: %v", err)
	}
	catalog := pluginSkillCatalogResult(t, a.PluginSkills())
	if len(catalog.Items) != 1 || !catalog.Items[0].Available || catalog.Items[0].Reason != "" || catalog.Items[0].Generation != status.Generation {
		t.Fatal("owned running skill was not advertised")
	}
	requirePluginSkillContent(t, a.PluginSkillRead(status.Manifest.ID, skillID, status.Digest, status.Generation), fixture, status)
	if _, err := fixture.manager.SetEnabled(a.ctx, status.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	requirePluginSkillFailure(t, a.PluginSkillRead(status.Manifest.ID, skillID, status.Digest, status.Generation), "operation_failed")
	catalog = pluginSkillCatalogResult(t, a.PluginSkills())
	if len(catalog.Items) != 1 || catalog.Items[0].Available || catalog.Items[0].Reason != "disabled" {
		t.Fatal("disabled skill remained available")
	}
	waitPluginSkillState(t, fixture, plugin.StateDisabled)
	if _, err := fixture.manager.SetEnabled(a.ctx, status.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	next := waitPluginSkillState(t, fixture, plugin.StateRunning)
	if next.Generation == status.Generation {
		t.Fatal("reenable reused the revoked generation")
	}
	requirePluginSkillFailure(t, a.PluginSkillRead(status.Manifest.ID, skillID, status.Digest, status.Generation), "operation_failed")
	wrongDigest := strings.Repeat("0", 64)
	if wrongDigest == next.Digest {
		wrongDigest = strings.Repeat("1", 64)
	}
	requirePluginSkillFailure(t, a.PluginSkillRead(next.Manifest.ID, skillID, wrongDigest, next.Generation), "operation_failed")
	requirePluginSkillFailure(t, a.PluginSkillRead(next.Manifest.ID, "undeclared", next.Digest, next.Generation), "operation_failed")
	requirePluginSkillFailure(t, a.PluginSkillRead("missing.skills", skillID, next.Digest, next.Generation), "operation_failed")
	requirePluginSkillContent(t, a.PluginSkillRead(next.Manifest.ID, skillID, next.Digest, next.Generation), fixture, next)
}

func TestPluginSkillReadOtherOwnerDeniedWithoutTakingLease(t *testing.T) {
	fixture := newPluginSkillFixture(t)
	a := fixture.app
	if _, err := fixture.manager.SetEnabled(a.ctx, fixture.inspection.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := fixture.manager.Start(a.ctx); err != nil {
		t.Fatal(err)
	}
	status := waitPluginSkillState(t, fixture, plugin.StateRunning)
	for _, name := range []string{"no local controller", "unstarted local controller"} {
		t.Run(name, func(t *testing.T) {
			if name == "unstarted local controller" {
				attachPluginSkillController(a, newPluginSkillController(t, a))
			}
			catalog := pluginSkillCatalogResult(t, a.PluginSkills())
			if len(catalog.Items) != 1 || catalog.Items[0].Available || catalog.Items[0].Reason != "runtime_unavailable" {
				t.Fatal("another execution owner's skill was available")
			}
			requirePluginSkillFailure(t, a.PluginSkillRead(status.Manifest.ID, "investigate", status.Digest, status.Generation), "runtime_unavailable")
			if _, err := PluginSkillManagerForIntegration(a.ctx, a); err == nil {
				t.Fatal("integration obtained another owner's skills")
			}
			if a.pluginRuntimeOwnsRuntime() || !fixture.manager.OwnsRuntime() {
				t.Fatal("skill access changed runtime ownership")
			}
		})
	}
}

func TestPluginSkillReadChangedPackageFailsWithSanitizedMessage(t *testing.T) {
	fixture := newPluginSkillFixture(t)
	status := startPluginSkillFixture(t, fixture)
	if err := os.Chmod(fixture.bodyPath, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fixture.bodyPath, []byte("untrusted-body-and-secret-marker"), 0o600); err != nil {
		t.Fatal(err)
	}
	result := fixture.app.PluginSkillRead(status.Manifest.ID, "investigate", status.Digest, status.Generation)
	requirePluginSkillFailure(t, result, "operation_failed")
	if strings.Contains(result.Message, fixture.app.configDir) || strings.Contains(result.Message, "untrusted-body-and-secret-marker") {
		t.Fatal("skill read failure disclosed raw package details")
	}
}

func TestPluginSkillReadInvalidInputDoesNotInitialize(t *testing.T) {
	a := newPluginTestApp(t)
	for _, tt := range []struct {
		name, pluginID, skillID, digest string
		generation                      uint64
	}{
		{name: "missing plugin", skillID: "review", digest: strings.Repeat("a", 64), generation: 1},
		{name: "plugin path", pluginID: "../private", skillID: "review", digest: strings.Repeat("a", 64), generation: 1},
		{name: "plugin empty component", pluginID: "test..skills", skillID: "review", digest: strings.Repeat("a", 64), generation: 1},
		{name: "plugin trailing dash", pluginID: "test.skills-", skillID: "review", digest: strings.Repeat("a", 64), generation: 1},
		{name: "plugin upper case", pluginID: "Test.skills", skillID: "review", digest: strings.Repeat("a", 64), generation: 1},
		{name: "plugin too long", pluginID: "test." + strings.Repeat("a", 124), skillID: "review", digest: strings.Repeat("a", 64), generation: 1},
		{name: "missing skill", pluginID: "test.skills", digest: strings.Repeat("a", 64), generation: 1},
		{name: "skill path", pluginID: "test.skills", skillID: "skills/SKILL.md", digest: strings.Repeat("a", 64), generation: 1},
		{name: "skill backslash", pluginID: "test.skills", skillID: `skills\review`, digest: strings.Repeat("a", 64), generation: 1},
		{name: "skill NUL", pluginID: "test.skills", skillID: "review\x00", digest: strings.Repeat("a", 64), generation: 1},
		{name: "skill upper case", pluginID: "test.skills", skillID: "Review", digest: strings.Repeat("a", 64), generation: 1},
		{name: "skill too long", pluginID: "test.skills", skillID: strings.Repeat("a", 65), digest: strings.Repeat("a", 64), generation: 1},
		{name: "missing digest", pluginID: "test.skills", skillID: "review", generation: 1},
		{name: "invalid digest", pluginID: "test.skills", skillID: "review", digest: strings.Repeat("g", 64), generation: 1},
		{name: "upper case digest", pluginID: "test.skills", skillID: "review", digest: strings.Repeat("A", 64), generation: 1},
		{name: "zero generation", pluginID: "test.skills", skillID: "review", digest: strings.Repeat("a", 64)},
		{name: "inexact generation", pluginID: "test.skills", skillID: "review", digest: strings.Repeat("a", 64), generation: 1 << 53},
	} {
		t.Run(tt.name, func(t *testing.T) {
			requirePluginSkillFailure(t, a.PluginSkillRead(tt.pluginID, tt.skillID, tt.digest, tt.generation), "invalid_request")
		})
	}
	for _, pluginID := range []string{"test.skills", "a.b.1", "test-publisher.review-1"} {
		if !validPluginSkillRequest(pluginID, "a_1.-", strings.Repeat("a", 64), maxPluginSkillGeneration) {
			t.Fatalf("valid boundary request rejected: %s", pluginID)
		}
	}
	requirePluginSkillNoStartup(t, a)
}
