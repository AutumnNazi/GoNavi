package app

import (
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginSkillResourceReadIsExplicit(t *testing.T) {
	fixture := newPluginSkillFixture(t)
	status := startPluginSkillFixture(t, fixture)
	resource := "skills/investigate/REFERENCE.md"
	result := fixture.app.PluginSkillResourceRead(status.Manifest.ID, "investigate", status.Digest, resource, status.Generation)
	value, ok := result.Data.(plugin.SkillContent)
	if !result.Success || !ok || value.Content != pluginSkillResourceBody || value.Resource != resource || value.SkillID != "investigate" {
		t.Fatalf("resource read: success=%t type=%T content=%q", result.Success, result.Data, value.Content)
	}
	entry := fixture.app.PluginSkillRead(status.Manifest.ID, "investigate", status.Digest, status.Generation)
	entryValue, _ := entry.Data.(plugin.SkillContent)
	if !entry.Success || entryValue.Content != pluginSkillTestBody || entryValue.Resource != "" {
		t.Fatal("entry read changed")
	}
	requirePluginSkillFailure(t, fixture.app.PluginSkillResourceRead(status.Manifest.ID, "investigate", status.Digest, "../SECRET.md", status.Generation), "invalid_request")
	requirePluginSkillFailure(t, fixture.app.PluginSkillResourceRead(status.Manifest.ID, "investigate", status.Digest, "skills/investigate/SKILL.md", status.Generation), "invalid_request")
}
