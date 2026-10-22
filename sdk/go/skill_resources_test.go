package plugin

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestValidateSkillResources(t *testing.T) {
	skill := Skill{Entry: "skills/guide/SKILL.md", Resources: []string{"skills/guide/REFERENCE.md"}}
	if err := ValidateSkillResources(skill); err != nil {
		t.Fatal(err)
	}
	if err := ValidateSkillResources(Skill{Entry: "SKILL.md", Resources: []string{strings.Repeat("a", 237) + ".md"}}); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []string{"../SKILL.md", "skills/guide/README.md", "skills/guide/SKILL.md/extra", strings.Repeat("a/", 33) + "SKILL.md", "skills/CON/SKILL.md", "skills/a<b/SKILL.md", "skills/a|b/SKILL.md", "skills/a\tb/SKILL.md"} {
		if err := ValidateSkillResources(Skill{Entry: entry}); err == nil {
			t.Fatalf("accepted entry %s", entry)
		}
	}
	if err := ValidateSkillResources(Skill{Entry: "SKILL.md", Resources: []string{strings.Repeat("b", 241) + ".md"}}); err == nil {
		t.Fatal("overlong path segment was accepted")
	}
	wide := strings.Repeat(strings.Repeat("文", 77)+"/", 12) + "SKILL.md"
	if utf8.RuneCountInString(wide) > 1024 {
		t.Fatal("multibyte fixture exceeds 1024 characters")
	}
	if err := ValidateSkillResources(Skill{Entry: wide}); err == nil {
		t.Fatal("multibyte entry over 1024 bytes was accepted")
	}
	if err := ValidateSkillResources(Skill{Entry: strings.Repeat("文", 81) + "/SKILL.md"}); err == nil {
		t.Fatal("multibyte segment over 240 bytes was accepted")
	}
	if err := ValidateSkillResources(Skill{Entry: "SKILL.md", Resources: []string{strings.Repeat(strings.Repeat("文", 77)+"/", 12) + "notes.md"}}); err == nil {
		t.Fatal("multibyte resource over 1024 bytes was accepted")
	}
	for _, resource := range []string{"skills/guide/SKILL.md", "skills/guide/run.sh", "../SECRET.md", "skills/guide/notes:1.md", "skills/NUL.md", "COM1.md"} {
		if err := ValidateSkillResources(Skill{Entry: "skills/guide/SKILL.md", Resources: []string{resource}}); err == nil {
			t.Fatalf("accepted %s", resource)
		}
	}
}
