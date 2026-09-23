//go:build windows

package app

import (
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
	if HandleWindowsRuntimeReaperArgs([]string{"--detached-window"}) {
		t.Fatal("detached-window mode was treated as the runtime reaper")
	}
	if !HandleWindowsRuntimeReaperArgs([]string{windowsRuntimeReaperArgument}) {
		t.Fatal("reaper mode without a parent pid fell through")
	}
	if !HandleWindowsRuntimeReaperArgs([]string{windowsRuntimeReaperArgument, "0"}) {
		t.Fatal("reaper mode with an invalid parent pid fell through")
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
