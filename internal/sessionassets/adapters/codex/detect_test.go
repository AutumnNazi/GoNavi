package codex

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveDataDirPrefersExplicitThenEnvThenHome(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	t.Setenv("CODEX_HOME", "")

	got, err := resolveDataDir("")
	if err != nil {
		t.Fatalf("resolve default: %v", err)
	}
	if want := filepath.Join(home, ".codex"); filepath.Clean(got) != filepath.Clean(want) {
		t.Fatalf("default data dir = %s, want %s", got, want)
	}

	t.Setenv("CODEX_HOME", filepath.Join(home, "custom"))
	got, err = resolveDataDir("")
	if err != nil {
		t.Fatalf("resolve env: %v", err)
	}
	if !strings.Contains(filepath.ToSlash(got), "/custom") {
		t.Fatalf("env data dir = %s, want custom path", got)
	}

	explicit := filepath.Join(home, "explicit")
	got, err = resolveDataDir(explicit)
	if err != nil {
		t.Fatalf("resolve explicit: %v", err)
	}
	if filepath.Clean(got) != filepath.Clean(explicit) {
		t.Fatalf("explicit data dir = %s, want %s", got, explicit)
	}
}

func TestDetectWithoutCommandOrDataIsNotInstalled(t *testing.T) {
	t.Setenv("CODEX_HOME", filepath.Join(t.TempDir(), "absent"))
	t.Setenv("PATH", "")
	detection := Detect(context.Background(), "", "")
	if detection.Status != StatusNotInstalled {
		t.Fatalf("status = %s, want %s", detection.Status, StatusNotInstalled)
	}
	if !contains(detection.Details, DetailCommandMissing) || !contains(detection.Details, DetailDataDirMissing) {
		t.Fatalf("details = %v, want command and data-dir missing", detection.Details)
	}
}

func TestDetectCommandWithoutDataIsNotInitialized(t *testing.T) {
	commandDir := t.TempDir()
	writeFakeCodexCommand(t, commandDir, "codex-cli 0.160.0")
	t.Setenv("CODEX_HOME", filepath.Join(t.TempDir(), "absent"))
	setPathForTest(t, commandDir)

	detection := Detect(context.Background(), "", "")
	if detection.Status != StatusNotInitialized {
		t.Fatalf("status = %s, want %s", detection.Status, StatusNotInitialized)
	}
	if detection.Version != "0.160.0" {
		t.Fatalf("version = %q, want 0.160.0", detection.Version)
	}
}

func TestDetectReadyWithReadableDataDir(t *testing.T) {
	commandDir := t.TempDir()
	writeFakeCodexCommand(t, commandDir, "codex-cli 0.161.0")
	dataDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dataDir, "sessions"), 0o700); err != nil {
		t.Fatalf("seed data dir: %v", err)
	}
	setPathForTest(t, commandDir)
	t.Setenv("CODEX_HOME", dataDir)

	detection := Detect(context.Background(), "", "")
	if detection.Status != StatusReady {
		t.Fatalf("status = %s, want %s (details %v)", detection.Status, StatusReady, detection.Details)
	}
	if !detection.DataReadable {
		t.Fatalf("data dir should be readable")
	}
	if detection.Version != "0.161.0" {
		t.Fatalf("version = %q, want 0.161.0", detection.Version)
	}
	if detection.DataDir == "" || detection.CommandPath == "" {
		t.Fatalf("detection must carry path evidence: %+v", detection)
	}
}

func TestDetectUnreadableDataDirReported(t *testing.T) {
	commandDir := t.TempDir()
	writeFakeCodexCommand(t, commandDir, "codex-cli 0.160.0")
	setPathForTest(t, commandDir)
	// 数据"目录"实际是文件：存在但不可作为目录读取。
	dataFile := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(dataFile, []byte("x"), 0o600); err != nil {
		t.Fatalf("write file: %v", err)
	}
	detection := Detect(context.Background(), "", dataFile)
	if detection.Status != StatusDataUnreadable {
		t.Fatalf("status = %s, want %s", detection.Status, StatusDataUnreadable)
	}
}

func writeFakeCodexCommand(t *testing.T, dir, versionOutput string) {
	t.Helper()
	path := filepath.Join(dir, "codex.cmd")
	script := "@echo off\r\necho " + versionOutput + "\r\n"
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatalf("write fake command: %v", err)
	}
}

func setPathForTest(t *testing.T, dir string) {
	t.Helper()
	original := os.Getenv("PATH")
	t.Setenv("PATH", dir+string(os.PathListSeparator)+original)
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
