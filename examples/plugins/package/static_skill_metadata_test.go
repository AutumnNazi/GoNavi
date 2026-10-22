package main

import (
	"strings"
	"testing"
)

func TestStaticSkillMetadataByteBounds(t *testing.T) {
	manifest := skillManifest()
	manifest.Contributes.Skills[0].Name = strings.Repeat("界", 85)
	manifest.Contributes.Skills[0].Description = strings.Repeat("界", 682)
	if err := validateSkillDeclarations(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Contributes.Skills[0].Name = strings.Repeat("界", 86)
	if err := validateSkillDeclarations(manifest); err == nil {
		t.Fatal("name over 256 bytes was accepted")
	}
	manifest.Contributes.Skills[0].Name = "Guide"
	manifest.Contributes.Skills[0].Description = strings.Repeat("界", 683)
	if err := validateSkillDeclarations(manifest); err == nil {
		t.Fatal("description over 2048 bytes was accepted")
	}
}
