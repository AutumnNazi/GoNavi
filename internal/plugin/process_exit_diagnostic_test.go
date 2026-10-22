package plugin

import (
	"context"
	"strings"
	"testing"
)

func TestPluginProcessExitReportsExitStatus(t *testing.T) {
	// The fixture exits while handling plugin.initialize. Wait closes the parent pipe ends before it
	// reports the exit, so a reader that publishes the closed-file error first would make the
	// quarantine record a pipe diagnostic instead of the real crash reason.
	m := testManager(t)
	status := installFixture(t, m, "test.exit-diagnostic", "crash")
	enableFixture(t, m, status.Manifest.ID)
	if err := m.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	faulted := waitState(t, m, status.Manifest.ID, StateFaulted)
	if !strings.Contains(faulted.LastError, "exit status 23") {
		t.Fatalf("crashed plugin reported %q", faulted.LastError)
	}
}
