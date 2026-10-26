package plugin

import (
	"context"
	"path/filepath"
	"testing"
)

func TestExampleSkillPackagePassesHostInspection(t *testing.T) {
	inspection, err := InspectPackage(context.Background(), filepath.Join("..", "..", "examples", "plugins", "skills"))
	if err != nil {
		t.Fatal(err)
	}
	if inspection.Manifest.ID != "sdk.examples.skills" || len(inspection.Manifest.Contributes.Skills) != 1 {
		t.Fatalf("example skill: %+v", inspection.Manifest.Contributes.Skills)
	}
	if len(inspection.Manifest.Contributes.Skills[0].Resources) != 1 {
		t.Fatal("example companion was dropped")
	}
}
