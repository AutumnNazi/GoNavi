package app

import (
	"path/filepath"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginInspectShippedStaticSkillExample(t *testing.T) {
	a := newPluginTestApp(t)
	result := a.PluginInspect(filepath.Join("..", "..", "examples", "plugins", "skills"))
	inspection, ok := result.Data.(plugin.Inspection)
	if !result.Success || !ok || inspection.Manifest.ID != "sdk.examples.skills" || inspection.Manifest.Backend != nil || inspection.Manifest.Window != nil {
		t.Fatalf("%+v", result)
	}
	if len(inspection.Manifest.Contributes.Skills) != 1 || len(inspection.Manifest.Contributes.Skills[0].Resources) != 1 {
		t.Fatalf("skills=%d", len(inspection.Manifest.Contributes.Skills))
	}
}
