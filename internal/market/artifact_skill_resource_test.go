package market

import "testing"

func TestArtifactSkillResourceMustBeDeclaredMarkdown(t *testing.T) {
	index := &artifactIndex{skillDocuments: map[string]bool{
		"skills/guide/SKILL.md": true, "skills/guide/REFERENCE.md": true,
	}}
	for _, name := range []string{"skills/guide/SKILL.md", "skills/guide/REFERENCE.md"} {
		if index.paths == nil {
			index.paths = map[string]artifactPath{}
		}
		index.paths[foldArtifactPath(name)] = artifactPath{name: name, explicit: true}
	}
	manifest := artifactManifest{Permissions: []string{"ai.skills"}, Contributes: artifactContributions{Skills: []artifactSkill{{
		ID: "guide", Name: "Guide", Description: "Read only", Entry: "skills/guide/SKILL.md",
		Resources: []string{"skills/guide/REFERENCE.md"},
	}}}}
	if err := index.validateSkillContributions(manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Contributes.Skills[0].Resources = []string{"skills/guide/run.sh"}
	if err := index.validateSkillContributions(manifest); err == nil {
		t.Fatal("script resource was accepted")
	}
}
