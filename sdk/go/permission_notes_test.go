package plugin

import (
	"strings"
	"testing"
)

func TestValidatePermissionNotes(t *testing.T) {
	valid := Manifest{Permissions: []string{"host.log"}, PermissionNotes: map[string]string{"host.log": "Writes one diagnostic line"}}
	if err := ValidatePermissionNotes(valid); err != nil {
		t.Fatal(err)
	}
	if err := ValidatePermissionNotes(Manifest{}); err != nil {
		t.Fatal(err)
	}
	undeclared := Manifest{Permissions: []string{"host.log"}, PermissionNotes: map[string]string{"data.export": "export"}}
	if err := ValidatePermissionNotes(undeclared); err == nil {
		t.Fatal("undeclared note accepted")
	}
	markup := Manifest{Permissions: []string{"host.log"}, PermissionNotes: map[string]string{"host.log": "<b>html</b>"}}
	if err := ValidatePermissionNotes(markup); err == nil {
		t.Fatal("markup note accepted")
	}
	bounded := Manifest{Permissions: []string{"host.log"}, PermissionNotes: map[string]string{"host.log": strings.Repeat("界", 53)}}
	if err := ValidatePermissionNotes(bounded); err != nil {
		t.Fatal(err)
	}
	bounded.PermissionNotes["host.log"] = strings.Repeat("界", 54)
	if err := ValidatePermissionNotes(bounded); err == nil {
		t.Fatal("note over 160 bytes was accepted")
	}
}
