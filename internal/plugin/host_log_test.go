package plugin

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestHostLogReachesTheHostOnlyWithPermission(t *testing.T) {
	m := testManager(t)
	var logged string
	previous := writeHostLog
	writeHostLog = func(id, level, message string) { logged = id + "|" + level + "|" + message }
	t.Cleanup(func() { writeHostLog = previous })
	status := installHostLogFixture(t, m, true)
	enableFixture(t, m, status.Manifest.ID)
	if err := m.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, status.Manifest.ID, StateRunning)
	body := waitHostLogResponse(t, m, status.Manifest.ID)
	if !strings.Contains(body, `"result"`) || logged != status.Manifest.ID+"|info|snapshot ready" {
		t.Fatalf("response %s log %q", body, logged)
	}
}

func TestHostLogRejectsMissingPermissionAndUnknownMethod(t *testing.T) {
	m := testManager(t)
	denied := installHostLogFixture(t, m, false)
	unknown := installHostLogMode(t, m, "example.hostunknown", "host-unknown", true)
	enableFixture(t, m, denied.Manifest.ID)
	enableFixture(t, m, unknown.Manifest.ID)
	if err := m.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, denied.Manifest.ID, StateRunning)
	waitState(t, m, unknown.Manifest.ID, StateRunning)
	if body := waitHostLogResponse(t, m, denied.Manifest.ID); !strings.Contains(body, `"code":-32003`) {
		t.Fatalf("denied response: %s", body)
	}
	if body := waitHostLogResponse(t, m, unknown.Manifest.ID); !strings.Contains(body, `"code":-32601`) {
		t.Fatalf("unknown response: %s", body)
	}
}

func installHostLogFixture(t *testing.T, m *Manager, permit bool) Status {
	t.Helper()
	return installHostLogMode(t, m, "example.hostlog", "host-log", permit)
}

func installHostLogMode(t *testing.T, m *Manager, id, mode string, permit bool) Status {
	t.Helper()
	manifest := basicManifest(id)
	if permit {
		manifest.Permissions = []string{"host.log"}
	}
	if mode == "host-describe" {
		manifest.Permissions = []string{"host.describe"}
		if !permit {
			manifest.Permissions = nil
		}
	}
	executable := "backend"
	if runtime.GOOS == "windows" {
		executable += ".exe"
	}
	manifest.Backend = &Backend{Default: &Entry{Executable: executable, Args: []string{"-test.run=^TestFixtureProcess$", "--", "--plugin-fixture", mode}}}
	manifest.Contributes.Commands = []Command{{ID: "echo", Title: "Echo"}}
	source := writePackage(t, manifest)
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	input, err := os.Open(binary)
	if err != nil {
		t.Fatal(err)
	}
	output, err := os.Create(filepath.Join(source, executable))
	if err != nil {
		input.Close()
		t.Fatal(err)
	}
	_, copyErr := output.ReadFrom(input)
	if input.Close() != nil || output.Close() != nil || copyErr != nil {
		t.Fatal(copyErr)
	}
	return installSource(t, m, source)
}

func waitHostLogResponse(t *testing.T, m *Manager, id string) string {
	t.Helper()
	path := filepath.Join(m.root, "data", id, "host-log-response.json")
	var body []byte
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		loaded, err := os.ReadFile(path)
		if err == nil && len(loaded) > 0 {
			body = loaded
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(body) == 0 {
		t.Fatalf("no host response for %s; statuses %+v", id, m.List())
	}
	return string(body)
}
