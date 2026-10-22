package plugin

import (
	"strings"
	"testing"
)

func TestValidateSkillMetadataByteLimits(t *testing.T) {
	skill := Skill{Name: strings.Repeat("中", 85), Description: strings.Repeat("文", 682)}
	if err := ValidateSkillMetadata(skill); err != nil {
		t.Fatal(err)
	}
	skill.Name = strings.Repeat("中", 86)
	if err := ValidateSkillMetadata(skill); err == nil {
		t.Fatal("name over 256 bytes was accepted")
	}
	skill.Name = "Guide"
	skill.Description = strings.Repeat("文", 683)
	if err := ValidateSkillMetadata(skill); err == nil {
		t.Fatal("description over 2048 bytes was accepted")
	}
}
