package plugin

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateCommandEffects(t *testing.T) {
	command := Command{ID: "run.now_1-A", Title: strings.Repeat("中", 85), Description: strings.Repeat("文", 1365), InputSchema: json.RawMessage(`{"type":"object"}`)}
	for _, effect := range []string{"", "read", "write", "unknown"} {
		command.Effect = effect
		if err := ValidateCommand(command); err != nil {
			t.Fatal(effect, err)
		}
	}
	for _, effect := range []string{"WRITE", "sideeffect", "Read"} {
		command.Effect = effect
		if err := ValidateCommand(command); err == nil {
			t.Fatalf("%s effect was accepted", effect)
		}
	}
	command.Effect = "read"
	command.ID = "-run"
	if ValidateCommand(command) == nil {
		t.Fatal("invalid command id was accepted")
	}
	command.ID = "run"
	command.Title = strings.Repeat("中", 86)
	if ValidateCommand(command) == nil {
		t.Fatal("title over 256 bytes was accepted")
	}
	command.Title = "Run"
	command.Description = strings.Repeat("文", 1366)
	if ValidateCommand(command) == nil {
		t.Fatal("description over 4096 bytes was accepted")
	}
	command.Description = ""
	command.InputSchema = json.RawMessage(`[]`)
	if ValidateCommand(command) == nil {
		t.Fatal("schema array was accepted")
	}
}
