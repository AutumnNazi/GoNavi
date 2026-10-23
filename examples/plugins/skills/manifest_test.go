package main

import (
	"encoding/json"
	"os"
	"testing"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func TestExampleSkillResourcesStayDeclaredMarkdown(t *testing.T) {
	raw, err := os.ReadFile("gonavi.plugin.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest plugin.Manifest
	if err = json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Contributes == nil || len(manifest.Contributes.Skills) != 1 {
		t.Fatal("example skill changed")
	}
	skill := manifest.Contributes.Skills[0]
	if err = plugin.ValidateSkillMetadata(skill); err != nil {
		t.Fatal(err)
	}
	if err = plugin.ValidateSkillResources(skill); err != nil {
		t.Fatal(err)
	}
	if skill.ID != "read-only-investigation" || skill.Entry != "skills/read-only-investigation/SKILL.md" || len(skill.Resources) != 1 || skill.Resources[0] != "skills/read-only-investigation/REFERENCE.md" {
		t.Fatalf("declaration: %+v", skill)
	}
	skill.Resources[0] = "skills/read-only-investigation/run.sh"
	if err = plugin.ValidateSkillResources(skill); err == nil {
		t.Fatal("script resource was accepted")
	}
}
