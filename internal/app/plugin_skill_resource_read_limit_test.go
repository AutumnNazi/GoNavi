package app

import (
	"bytes"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginSkillResourceReadKeepsExactSize(t *testing.T) {
	body := bytes.Repeat([]byte{'x'}, 64<<10)
	fixture := newPluginSkillFixtureWithResource(t, body)
	status := startPluginSkillFixture(t, fixture)
	resource := "skills/investigate/REFERENCE.md"
	result := fixture.app.PluginSkillResourceRead(status.Manifest.ID, "investigate", status.Digest, resource, status.Generation)
	value, ok := result.Data.(plugin.SkillContent)
	if !result.Success || !ok || value.Content != string(body) || value.Resource != resource {
		t.Fatalf("len=%d success=%t", len(value.Content), result.Success)
	}
	entry := fixture.app.PluginSkillRead(status.Manifest.ID, "investigate", status.Digest, status.Generation)
	entryValue, _ := entry.Data.(plugin.SkillContent)
	if !entry.Success || entryValue.Content != pluginSkillTestBody || strings.Contains(entryValue.Content, "xxx") {
		t.Fatalf("entry changed: %+v", entryValue)
	}
}
