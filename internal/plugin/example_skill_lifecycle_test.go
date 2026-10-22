package plugin

import (
	"context"
	"path/filepath"
	"testing"
)

func TestShippedStaticSkillExampleCanBeDisabledAndEnabled(t *testing.T) {
	manager := testManager(t)
	status := installSource(t, manager, filepath.Join("..", "..", "examples", "plugins", "skills"))
	if status.Manifest.ID != "sdk.examples.skills" || status.Manifest.Backend != nil || status.Manifest.Window != nil {
		t.Fatalf("%+v", status.Manifest)
	}
	if _, err := manager.SetEnabled(context.Background(), status.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	disabled := waitState(t, manager, status.Manifest.ID, StateDisabled)
	if disabled.DesiredEnabled {
		t.Fatal("disable left the example enabled")
	}
	enableFixture(t, manager, status.Manifest.ID)
	if err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	running := waitState(t, manager, status.Manifest.ID, StateRunning)
	manager.mu.Lock()
	instance := manager.instances[running.Manifest.ID]
	manager.mu.Unlock()
	if instance == nil || instance.process != nil {
		t.Fatal("static example acquired a native process")
	}
	if _, err := manager.SetEnabled(context.Background(), running.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	waitState(t, manager, running.Manifest.ID, StateDisabled)
	for _, item := range manager.List() {
		if item.Manifest.ID == "sdk.examples.skills" {
			return
		}
	}
	t.Fatal("disabling removed the installed example")
}
