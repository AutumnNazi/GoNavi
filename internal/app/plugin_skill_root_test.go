package app

import "testing"

func TestPluginSkillReadsRejectChangedDataRoot(t *testing.T) {
	fixture := newPluginSkillFixture(t)
	status := startPluginSkillFixture(t, fixture)
	fixture.app.configDir = t.TempDir()
	if _, err := PluginSkillManagerForIntegration(fixture.app.ctx, fixture.app); err == nil {
		t.Fatal("integration getter returned the previous data-root owner")
	}
	result := fixture.app.PluginSkillRead(status.Manifest.ID, "investigate", status.Digest, status.Generation)
	if result.Success {
		t.Fatal("preview read a skill from the previous data root")
	}
	if listed := fixture.app.PluginSkills(); listed.Success {
		t.Fatal("catalog read the previous data root")
	}
}
