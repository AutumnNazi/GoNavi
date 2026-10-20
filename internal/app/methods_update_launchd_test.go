package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestMacUpdateLaunchdPlistEscapesScriptPath(t *testing.T) {
	plist := macUpdateLaunchdPlist("com.gonavi.updater.1", `/tmp/a&b<c>.sh`)
	if strings.Contains(plist, "KeepAlive") {
		t.Fatal("one-shot updater must not set KeepAlive, or a failed install would relaunch forever")
	}
	for _, token := range []string{
		"<key>RunAtLoad</key><true/>",
		"<key>AbandonProcessGroup</key><true/>",
		"<string>/bin/bash</string>",
		"<string>com.gonavi.updater.1</string>",
		"<string>/tmp/a&amp;b&lt;c&gt;.sh</string>",
	} {
		if !strings.Contains(plist, token) {
			t.Fatalf("launchd plist missing %q\n%s", token, plist)
		}
	}
}

func TestStartMacUpdateViaLaunchdBootstrapsUserDomain(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "update.sh")
	if err := os.WriteFile(script, []byte("#!/bin/bash\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	var got []string
	original := runMacUpdateLaunchctl
	runMacUpdateLaunchctl = func(args ...string) error {
		got = append([]string(nil), args...)
		return nil
	}
	t.Cleanup(func() { runMacUpdateLaunchctl = original })

	if err := startMacUpdateViaLaunchd(script); err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0] != "bootstrap" || !strings.HasPrefix(got[1], "gui/") || got[2] != filepath.Join(dir, "gonavi-update.plist") {
		t.Fatalf("launchctl args = %#v", got)
	}
	plist, err := os.ReadFile(got[2])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(plist), "<string>/bin/bash</string>") || !strings.Contains(string(plist), "<string>"+script+"</string>") {
		t.Fatalf("plist does not launch the update script:\n%s", plist)
	}
}

func TestStartMacUpdateViaLaunchdReturnsLaunchctlError(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "update.sh")
	if err := os.WriteFile(script, []byte("#!/bin/bash\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	original := runMacUpdateLaunchctl
	runMacUpdateLaunchctl = func(args ...string) error {
		return os.ErrPermission
	}
	t.Cleanup(func() { runMacUpdateLaunchctl = original })

	err := startMacUpdateViaLaunchd(script)
	if err == nil {
		t.Fatal("expected launchctl failure to abort install before the app quits")
	}
}

func TestBuildMacScriptSurvivesHangupAfterHostExit(t *testing.T) {
	script := buildMacScript("/tmp/pkg.dmg", "/Applications/GoNavi.app", "/tmp/updates", "/tmp/updates/stage", "/tmp/updates/stage/mnt", "/tmp/updates/install.log", 7)
	if !strings.Contains(script, "trap '' HUP") {
		t.Fatal("mac update script must ignore SIGHUP after the host app exits")
	}
	hostIdx := strings.Index(script, `log "host process exited after ${WAIT_PID_SECONDS}s"`)
	continueIdx := strings.Index(script, `log "continuing install after host exit"`)
	prepareIdx := strings.Index(script, "if ! prepare_app_source_from_package; then")
	if hostIdx < 0 || continueIdx < 0 || prepareIdx < 0 || !(hostIdx < continueIdx && continueIdx < prepareIdx) {
		t.Fatalf("install continuation must be logged after host exit and before preparing the package (host=%d continue=%d prepare=%d)", hostIdx, continueIdx, prepareIdx)
	}
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("bash not available")
	}
	cmd := exec.Command(bash, "-n")
	cmd.Stdin = strings.NewReader(script)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("generated mac update script failed bash -n: %v\n%s", err, output)
	}
}
