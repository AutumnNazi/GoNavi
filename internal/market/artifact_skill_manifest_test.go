package market

import (
	"context"
	"strings"
	"testing"
)

func TestArtifactSkillsRejectInvalidMetadata(t *testing.T) {
	cases := []struct {
		name  string
		patch map[string]any
	}{
		{name: "empty id", patch: map[string]any{"id": ""}},
		{name: "uppercase id", patch: map[string]any{"id": "Notes"}},
		{name: "colon id", patch: map[string]any{"id": "notes:other"}},
		{name: "digit prefix", patch: map[string]any{"id": "1notes"}},
		{name: "long id", patch: map[string]any{"id": strings.Repeat("a", 65)}},
		{name: "blank name", patch: map[string]any{"name": " 	"}},
		{name: "long name", patch: map[string]any{"name": strings.Repeat("n", 257)}},
		{name: "name byte bound", patch: map[string]any{"name": strings.Repeat("界", 86)}},
		{name: "nul name", patch: map[string]any{"name": "name" + string(rune(0))}},
		{name: "blank description", patch: map[string]any{"description": "\n"}},
		{name: "long description", patch: map[string]any{"description": strings.Repeat("d", 2049)}},
		{name: "description byte bound", patch: map[string]any{"description": strings.Repeat("界", 683)}},
		{name: "nul description", patch: map[string]any{"description": "description" + string(rune(0))}},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				manifest := artifactSkillManifest(t, func(_ map[string]any, skill map[string]any) {
					for key, value := range test.patch {
						skill[key] = value
					}
				})
				filename, _ := artifactSkillArchive(t, format, manifest, artifactSkillTestEntry, []byte("valid text"))
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("accepted invalid skill metadata")
				}
			})
		}
	}
}

func TestArtifactSkillsAcceptExactMetadataBounds(t *testing.T) {
	manifest := artifactSkillManifest(t, func(_ map[string]any, skill map[string]any) {
		skill["name"] = strings.Repeat("界", 85)
		skill["description"] = strings.Repeat("界", 682)
	})
	for _, format := range []string{".zip", ".tgz"} {
		filename, _ := artifactSkillArchive(t, format, manifest, artifactSkillTestEntry, []byte("valid text"))
		if _, err := ValidatePackage(context.Background(), filename); err != nil {
			t.Fatalf("%s: %v", format, err)
		}
	}
}

func TestArtifactSkillsRequireExplicitPermissionAndUniqueIDs(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any, map[string]any)
	}{
		{name: "no permission", change: func(fields map[string]any, _ map[string]any) { fields["permissions"] = []string{} }},
		{name: "tools not skills", change: func(fields map[string]any, _ map[string]any) { fields["permissions"] = []string{"ai.tools"} }},
		{name: "near match permission", change: func(fields map[string]any, _ map[string]any) { fields["permissions"] = []string{"ai.skills.read"} }},
		{name: "duplicate id", change: func(fields map[string]any, skill map[string]any) {
			fields["contributes"].(map[string]any)["skills"] = []any{skill, skill}
		}},
		{name: "too many", change: func(fields map[string]any, skill map[string]any) {
			skills := make([]any, 17)
			for i := range skills {
				skills[i] = map[string]any{"id": "s" + strings.Repeat("x", i), "name": skill["name"], "description": skill["description"], "entry": skill["entry"]}
			}
			fields["contributes"].(map[string]any)["skills"] = skills
		}},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				filename, _ := artifactSkillArchive(t, format, artifactSkillManifest(t, test.change), artifactSkillTestEntry, []byte("Valid text"))
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("accepted unauthorized or duplicate skill declaration")
				}
			})
		}
	}
}

func TestArtifactSkillsRequireCanonicalSkillEntry(t *testing.T) {
	entries := []string{"", "/SKILL.md", "../SKILL.md", "./SKILL.md", "skills/../SKILL.md", "skills//SKILL.md", "skills\\notes\\SKILL.md", "C:/SKILL.md", "https://example.invalid/SKILL.md", "skills/notes/skill.md", "skills/notes/SKILL.MD", "skills/notes/NOTSKILL.md", "skills/notes/SKILL.md/", "CON/SKILL.md", "skills/notes/SKILL.md.exe"}
	for _, format := range []string{".zip", ".tgz"} {
		for _, entry := range entries {
			t.Run(format+"/"+entry, func(t *testing.T) {
				manifest := artifactSkillManifest(t, func(_ map[string]any, skill map[string]any) { skill["entry"] = entry })
				filename, _ := artifactSkillArchive(t, format, manifest, artifactSkillTestEntry, []byte("Valid text"))
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("accepted noncanonical skill entry")
				}
			})
		}
	}
}

func TestArtifactSkillsKeepContributionNamespacesIndependent(t *testing.T) {
	manifest := artifactDataSourceManifest(t, func(fields map[string]any, source map[string]any) {
		source["command"] = "database"
		fields["permissions"] = []string{"data.sources", "ai.skills"}
		contributes := fields["contributes"].(map[string]any)
		contributes["commands"] = []any{map[string]any{"id": "database", "title": "Read-only protocol", "effect": "read"}}
		contributes["skills"] = []any{map[string]any{"id": "database", "name": "Guide", "description": "Read-only guidance", "entry": artifactSkillTestEntry}}
	})
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format, func(t *testing.T) {
			entries := append(artifactTestEntries(manifest), artifactTestEntry{name: artifactSkillTestEntry, body: []byte("Guidance only")})
			filename := artifactTestWrite(t, format, artifactTestArchive(t, format, entries))
			if _, err := ValidatePackage(context.Background(), filename); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestArtifactSkillsStrictJSONShape(t *testing.T) {
	manifest := artifactSkillManifest(t, nil)
	cases := map[string]string{
		"array null": artifactSkillManifest(t, func(fields map[string]any, _ map[string]any) { fields["contributes"].(map[string]any)["skills"] = nil }),
		"array object": artifactSkillManifest(t, func(fields map[string]any, skill map[string]any) {
			fields["contributes"].(map[string]any)["skills"] = skill
		}),
		"element null": artifactSkillManifest(t, func(fields map[string]any, _ map[string]any) {
			fields["contributes"].(map[string]any)["skills"] = []any{nil}
		}),
		"array case":           strings.Replace(manifest, "\"skills\":", "\"Skills\":", 1),
		"duplicate array":      strings.Replace(manifest, "\"skills\":", "\"skills\":[],\"skills\":", 1),
		"duplicate id":         strings.Replace(manifest, "\"id\":\"notes\"", "\"id\":\"notes\",\"id\":\"other\"", 1),
		"escaped duplicate id": strings.Replace(manifest, "\"id\":\"notes\"", "\"id\":\"notes\",\"\\u0069d\":\"other\"", 1),
		"case id":              strings.Replace(manifest, "\"id\":\"notes\"", "\"ID\":\"notes\"", 1),
	}
	for _, field := range []string{"id", "name", "description", "entry"} {
		cases[field+" null"] = artifactSkillManifest(t, func(_ map[string]any, skill map[string]any) { skill[field] = nil })
		cases[field+" wrong type"] = artifactSkillManifest(t, func(_ map[string]any, skill map[string]any) { skill[field] = false })
		cases[field+" missing"] = artifactSkillManifest(t, func(_ map[string]any, skill map[string]any) { delete(skill, field) })
	}
	cases["unknown body"] = artifactSkillManifest(t, func(_ map[string]any, skill map[string]any) { skill["body"] = "must not inline body" })
	cases["unknown tool grants"] = artifactSkillManifest(t, func(_ map[string]any, skill map[string]any) { skill["tools"] = []string{"query"} })
	for _, format := range []string{".zip", ".tgz"} {
		for name, encoded := range cases {
			t.Run(format+"/"+name, func(t *testing.T) {
				filename, _ := artifactSkillArchive(t, format, encoded, artifactSkillTestEntry, []byte("Valid text"))
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("accepted ambiguous or malformed skills JSON")
				}
			})
		}
	}
}
