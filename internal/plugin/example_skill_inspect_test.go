package plugin

import (
	"context"
	"path/filepath"
	"testing"
)

func TestInspectShippedStaticSkillExample(t *testing.T) {
	inspection, err := InspectPackage(context.Background(), filepath.Join("..", "..", "examples", "plugins", "skills"))
	if err != nil || inspection.Manifest.ID != "sdk.examples.skills" || inspection.Manifest.Backend != nil || inspection.Manifest.Window != nil {
		t.Fatal(err)
	}
	if len(inspection.Manifest.Contributes.Skills) != 1 || len(inspection.Manifest.Contributes.Skills[0].Resources) != 1 {
		t.Fatalf("skills=%d", len(inspection.Manifest.Contributes.Skills))
	}
}
