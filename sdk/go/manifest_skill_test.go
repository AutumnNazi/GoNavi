package plugin

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestStaticSkillManifestWireShape(t *testing.T) {
	skill := Skill{ID: "guide", Name: "Guide", Description: "Read-only investigation", Entry: "skills/guide/SKILL.md"}
	manifest := Manifest{SchemaVersion: 1, APIVersion: 1, ID: "example.skills", Name: "Skills", Version: "1.0.0", Permissions: []string{"ai.skills"}, Contributes: &Contributions{Skills: []Skill{skill}}}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for _, absent := range []string{`"backend"`, `"commands"`, `"panels"`, `"content"`} {
		if strings.Contains(string(raw), absent) {
			t.Fatalf("static declaration leaked execution/body field %s", absent)
		}
	}
	var decoded Manifest
	if err = json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	got, gotErr := json.Marshal(decoded.Contributes.Skills)
	want, wantErr := json.Marshal([]Skill{skill})
	if decoded.Contributes == nil || gotErr != nil || wantErr != nil || string(got) != string(want) {
		t.Fatal("skill declaration did not roundtrip")
	}
}

func TestSkillContentCarriesExplicitProvenance(t *testing.T) {
	value := SkillContent{PluginID: "example.skills", SkillID: "guide", Name: "Guide", Description: "Description", Version: "1.0.0", Digest: strings.Repeat("a", 64), Generation: 7, Content: "opaque markdown"}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != 8 || string(fields["generation"]) != "7" || string(fields["content"]) != `"opaque markdown"` {
		t.Fatalf("unexpected content DTO: %s", raw)
	}
}
