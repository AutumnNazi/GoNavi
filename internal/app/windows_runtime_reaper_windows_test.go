//go:build windows

package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestWindowsRuntimeProcessReaper(t *testing.T) {
	helperPath := filepath.Join(t.TempDir(), "webview-reaper-helper.exe")
	build := exec.Command("go", "build", "-ldflags=-H=windowsgui", "-o", helperPath, "./testdata/windows_reaper_helper")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build reaper helper: %v\n%s", err, output)
	}

	t.Run("command line", func(t *testing.T) {
		marker := filepath.Join(t.TempDir(), "WebViewData")
		command := startWindowsReaperHelper(t, helperPath, marker)
		got, err := readProcessCommandLine(uint32(command.Process.Pid))
		if err != nil {
			t.Fatalf("readProcessCommandLine: %v", err)
		}
		if !commandLineUsesUserDataDir(got, true, []string{marker}) {
			t.Fatalf("command line %q does not contain user data marker %s", got, marker)
		}
	})

	t.Run("orphan kill", func(t *testing.T) {
		marker := filepath.Join(t.TempDir(), "WebViewData")
		command := startWindowsReaperHelper(t, helperPath, marker)
		imageName := strings.ToLower(filepath.Base(helperPath))
		deadline := time.Now().Add(5 * time.Second)
		var killed int
		for {
			count, err := terminateOrphanedWebViewProcesses(imageName, map[string]struct{}{"not-a-real-host.exe": {}}, []string{marker})
			if err != nil {
				t.Fatalf("terminateOrphanedWebViewProcesses: %v", err)
			}
			killed += count
			if !windowsProcessAlive(command.Process.Pid) {
				break
			}
			if time.Now().After(deadline) {
				commandLine, readErr := readProcessCommandLine(uint32(command.Process.Pid))
				t.Fatalf("helper pid %d still alive, killed=%d commandLine=%q readErr=%v", command.Process.Pid, killed, commandLine, readErr)
			}
			time.Sleep(50 * time.Millisecond)
		}
		if killed == 0 {
			t.Fatal("expected the orphaned helper process to be terminated")
		}
	})

	t.Run("wait parent exit", func(t *testing.T) {
		command := startWindowsReaperHelper(t, helperPath, filepath.Join(t.TempDir(), "unused"))
		done := make(chan error, 1)
		go func() {
			done <- waitForWindowsProcessExit(command.Process.Pid)
		}()
		if err := command.Process.Kill(); err != nil {
			t.Fatalf("kill helper: %v", err)
		}
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("waitForWindowsProcessExit: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("timed out waiting for helper process exit")
		}
	})
}

func startWindowsReaperHelper(t *testing.T, helperPath, marker string) *exec.Cmd {
	t.Helper()
	command := exec.Command(helperPath, "--user-data-dir="+marker)
	if err := command.Start(); err != nil {
		t.Fatalf("start helper: %v", err)
	}
	t.Cleanup(func() {
		if command.Process != nil {
			_ = command.Process.Kill()
			_, _ = command.Process.Wait()
		}
	})
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if windowsProcessAlive(command.Process.Pid) {
			return command
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("helper pid %d did not stay running", command.Process.Pid)
	return command
}

func TestHandleWindowsRuntimeReaperArgsDoesNotStealNormalStartup(t *testing.T) {
	if HandleWindowsRuntimeReaperArgs(nil) {
		t.Fatal("empty args were treated as the runtime reaper")
	}
	if HandleWindowsUpdateCleanupArgs(nil) {
		t.Fatal("empty args were treated as the update cleanup helper")
	}
	if HandleWindowsRuntimeReaperArgs([]string{"--detached-window"}) {
		t.Fatal("detached-window mode was treated as the runtime reaper")
	}
	if HandleWindowsUpdateCleanupArgs([]string{"--detached-window"}) {
		t.Fatal("detached-window mode was treated as the update cleanup helper")
	}
	if !HandleWindowsRuntimeReaperArgs([]string{windowsRuntimeReaperArgument}) {
		t.Fatal("reaper mode without a parent pid fell through")
	}
	if !HandleWindowsRuntimeReaperArgs([]string{windowsRuntimeReaperArgument, "0"}) {
		t.Fatal("reaper mode with an invalid parent pid fell through")
	}
}

func TestWindowsUpdateCleanupWaitsForUpdaterBeforeRemovingWorkspace(t *testing.T) {
	localAppData := t.TempDir()
	t.Setenv("LOCALAPPDATA", localAppData)
	cleanupDir := filepath.Join(localAppData, "GoNavi", "updates", "1.2.3")
	if err := os.MkdirAll(cleanupDir, 0o755); err != nil {
		t.Fatalf("MkdirAll cleanup directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cleanupDir, "update.log"), []byte("ready"), 0o644); err != nil {
		t.Fatalf("WriteFile cleanup marker: %v", err)
	}
	helperPath := filepath.Join(t.TempDir(), "cleanup-parent.exe")
	build := exec.Command("go", "build", "-ldflags=-H=windowsgui", "-o", helperPath, "./testdata/windows_reaper_helper")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build cleanup parent helper: %v\n%s", err, output)
	}
	parent := startWindowsReaperHelper(t, helperPath, "")
	done := make(chan error, 1)
	go func() { done <- runWindowsUpdateCleanup(parent.Process.Pid, cleanupDir) }()
	time.Sleep(100 * time.Millisecond)
	if _, err := os.Stat(cleanupDir); err != nil {
		t.Fatalf("cleanup directory removed before updater exited: %v", err)
	}
	if err := parent.Process.Kill(); err != nil {
		t.Fatalf("kill updater helper: %v", err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("runWindowsUpdateCleanup: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for update cleanup")
	}
	if _, err := os.Stat(cleanupDir); !os.IsNotExist(err) {
		t.Fatalf("cleanup directory still exists, stat err=%v", err)
	}
}

func TestParseWindowsUpdateCleanupArgsRejectsBroadOrForeignDirectory(t *testing.T) {
	localAppData := t.TempDir()
	t.Setenv("LOCALAPPDATA", localAppData)
	root := filepath.Join(localAppData, "GoNavi", "updates")
	valid := filepath.Join(root, "1.2.3")
	if _, got, err := parseWindowsUpdateCleanupArgs([]string{windowsUpdateCleanupArgument, "12345"}, valid); err != nil || got != valid {
		t.Fatalf("valid cleanup args = (%q, %v), want %q", got, err, valid)
	}
	for _, path := range []string{root, localAppData, filepath.Join(localAppData, "foreign", "1.2.3")} {
		if _, _, err := parseWindowsUpdateCleanupArgs([]string{windowsUpdateCleanupArgument, "12345"}, path); err == nil {
			t.Fatalf("unsafe cleanup path %q was accepted", path)
		}
	}
}

func windowsProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return false
	}
	defer windows.CloseHandle(handle)
	result, err := windows.WaitForSingleObject(handle, 0)
	if err != nil {
		return false
	}
	return result == uint32(windows.WAIT_TIMEOUT)
}
