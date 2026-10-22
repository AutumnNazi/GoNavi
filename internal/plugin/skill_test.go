package plugin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func skillManifest() Manifest {
	manifest := basicManifest("example.skills")
	manifest.Permissions = []string{"ai.skills"}
	manifest.Contributes.Skills = []Skill{{ID: "guide", Name: "Read-only guide", Description: "Investigate safely without granting tools.", Entry: "skills/guide/SKILL.md"}}
	return manifest
}

func skillPackage(t *testing.T, manifest Manifest, body []byte) string {
	t.Helper()
	directory := writePackage(t, manifest)
	for _, skill := range manifest.Contributes.Skills {
		target := filepath.Join(directory, filepath.FromSlash(skill.Entry))
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, body, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return directory
}

func TestSkillManifestValidation(t *testing.T) {
	cases := []struct {
		name   string
		change func(*Manifest)
	}{
		{"permission absent", func(m *Manifest) { m.Permissions = nil }},
		{"permission alias", func(m *Manifest) { m.Permissions = []string{"AI.Skills"} }},
		{"id case", func(m *Manifest) { m.Contributes.Skills[0].ID = "Guide" }},
		{"id colon", func(m *Manifest) { m.Contributes.Skills[0].ID = "guide:other" }},
		{"id path", func(m *Manifest) { m.Contributes.Skills[0].ID = "../guide" }},
		{"id oversized", func(m *Manifest) { m.Contributes.Skills[0].ID = strings.Repeat("a", 65) }},
		{"name blank", func(m *Manifest) { m.Contributes.Skills[0].Name = " \n" }},
		{"name byte limit", func(m *Manifest) { m.Contributes.Skills[0].Name = strings.Repeat("中", 86) }},
		{"name nul", func(m *Manifest) { m.Contributes.Skills[0].Name = "bad\x00name" }},
		{"name invalid utf8", func(m *Manifest) { m.Contributes.Skills[0].Name = string([]byte{0xff}) }},
		{"description blank", func(m *Manifest) { m.Contributes.Skills[0].Description = "" }},
		{"description oversized", func(m *Manifest) { m.Contributes.Skills[0].Description = strings.Repeat("x", 2049) }},
		{"description byte limit", func(m *Manifest) { m.Contributes.Skills[0].Description = strings.Repeat("文", 683) }},
		{"description invalid utf8", func(m *Manifest) { m.Contributes.Skills[0].Description = string([]byte{0xff}) }},
		{"duplicate id", func(m *Manifest) { m.Contributes.Skills = append(m.Contributes.Skills, m.Contributes.Skills[0]) }},
		{"too many", func(m *Manifest) {
			for i := 0; i < maxSkills; i++ {
				s := m.Contributes.Skills[0]
				s.ID = "skill" + string(rune('a'+i))
				m.Contributes.Skills = append(m.Contributes.Skills, s)
			}
		}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			manifest := skillManifest()
			test.change(&manifest)
			if ValidateManifest(manifest) == nil {
				t.Fatal("invalid skill declaration accepted")
			}
		})
	}
	bounded := skillManifest()
	bounded.Contributes.Skills[0].Name = strings.Repeat("中", 85)
	bounded.Contributes.Skills[0].Description = strings.Repeat("文", 682)
	if err := ValidateManifest(bounded); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []string{"", "skill.md", "SKILL.MD", "guide.md", "/SKILL.md", "../SKILL.md", "skills/../SKILL.md", "skills//SKILL.md", "C:/SKILL.md", "skills\\SKILL.md", "https://evil/SKILL.md", "skills./SKILL.md", "CON/SKILL.md"} {
		t.Run(entry, func(t *testing.T) {
			manifest := skillManifest()
			manifest.Contributes.Skills[0].Entry = entry
			if ValidateManifest(manifest) == nil {
				t.Fatalf("unsafe entry accepted: %q", entry)
			}
		})
	}
}

func TestSkillManifestStaticBoundsAndNoImplicitAuthority(t *testing.T) {
	manifest := skillManifest()
	manifest.Contributes.Skills[0].Entry = "SKILL.md"
	manifest.Contributes.Skills[0].Name = strings.Repeat("x", 256)
	manifest.Contributes.Skills[0].Description = strings.Repeat("x", 2048)
	for i := 1; i < maxSkills; i++ {
		s := manifest.Contributes.Skills[0]
		s.ID = "skill" + string(rune('a'+i))
		manifest.Contributes.Skills = append(manifest.Contributes.Skills, s)
	}
	if err := ValidateManifest(manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Backend != nil {
		t.Fatal("static skill acquired a backend")
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ParseManifest(raw); err != nil {
		t.Fatal(err)
	}
	legacy := basicManifest("example.legacy")
	if err = ValidateManifest(legacy); err != nil {
		t.Fatal(err)
	}
}

func TestSkillStrictJSON(t *testing.T) {
	valid := `{"id":"guide","name":"Guide","description":"Description","entry":"SKILL.md"}`
	cases := []string{
		`null`, `[]`, `"script"`,
		strings.Replace(valid, `"description":"Description",`, "", 1),
		strings.Replace(valid, `"name":"Guide"`, `"name":null`, 1),
		strings.Replace(valid, `"entry":"SKILL.md"`, `"Entry":"SKILL.md"`, 1),
		strings.Replace(valid, `"entry":"SKILL.md"`, `"entry":"bad","entry":"SKILL.md"`, 1),
		strings.Replace(valid, `"entry":"SKILL.md"`, `"entry":"bad","\u0065ntry":"SKILL.md"`, 1),
		strings.Replace(valid, `"entry":"SKILL.md"`, `"entry":"SKILL.md","requiredTools":["shell"]`, 1),
		strings.Replace(valid, `"entry":"SKILL.md"`, `"entry":"SKILL.md","hooks":{}`, 1),
		strings.Replace(valid, "Guide", string([]byte{0xff}), 1),
	}
	for _, value := range cases {
		var skill Skill
		if json.Unmarshal([]byte(value), &skill) == nil {
			t.Fatal("ambiguous skill JSON accepted")
		}
	}
	var skill Skill
	if err := json.Unmarshal([]byte(valid), &skill); err != nil {
		t.Fatal(err)
	}
}
