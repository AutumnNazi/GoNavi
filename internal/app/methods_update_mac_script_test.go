package app

import (
	"strings"
	"testing"
)

func TestBuildMacScriptContainsHardeningGuards(t *testing.T) {
	script := buildMacScript(
		"/tmp/GoNavi/updates/1.2.3/GoNavi-1.2.3-MacOS-Arm64.dmg",
		"/Applications/GoNavi.app",
		"/tmp/GoNavi/updates",
		"/tmp/GoNavi/updates/1.2.3/stage",
		"/tmp/GoNavi/updates/1.2.3/stage/mnt",
		"/tmp/GoNavi/updates/1.2.3/gonavi-update-macos.log",
		4242,
	)

	mustContain := []string{
		"MAX_WAIT_PID_SECONDS=120",
		"hdiutil attach",
		"prepare_app_source_from_package",
		"resolve_app_binary_rel",
		"replace_app_direct",
		"run_admin_replace",
		"relaunch_app",
		`open -n "$TARGET_APP"`,
		`nohup "$TARGET_APP/$APP_BIN_REL" >/dev/null 2>&1 &`,
		// 安装包扩展名分支
		"dmg)",
		"zip)",
		// 所有失败路径都必须显式通知用户（脱离主进程静默运行，否则表现为「点击无反应」）
		"notify_failure",
		// relaunch 成功后删除整个 updates 目录，失败则保留
		`exec /bin/rm -rf "$UPDATES_DIR"`,
	}
	for _, token := range mustContain {
		if !strings.Contains(script, token) {
			t.Fatalf("mac update script missing required token %q\nscript:\n%s", token, script)
		}
	}
	if strings.Contains(script, `rm -rf "$MOUNT_DIR" "$DMG" "$STAGED"`) {
		t.Fatal("mac update script must not delete STAGED while the script may still be running from it")
	}
	if strings.Contains(script, "com.apple.quarantine") || strings.Contains(script, "xattr -rd") {
		t.Fatal("mac updater must preserve Gatekeeper quarantine metadata; notarized releases must not depend on clearing it")
	}
	// 确保不会在 relaunch 之前删除 updates 目录。
	rmIdx := strings.Index(script, `exec /bin/rm -rf "$UPDATES_DIR"`)
	relaunchIdx := strings.Index(script, "if ! relaunch_app; then")
	if rmIdx < 0 || relaunchIdx < 0 || rmIdx < relaunchIdx {
		t.Fatalf("updates cleanup must happen only after relaunch attempt (rmIdx=%d relaunchIdx=%d)", rmIdx, relaunchIdx)
	}
	if strings.Contains(script[rmIdx+len(`exec /bin/rm -rf "$UPDATES_DIR"`):], `log "`) {
		t.Fatal("mac update script must not write installation logs after deleting the updates directory")
	}
	if !strings.Contains(script, "/tmp/GoNavi/updates/1.2.3/GoNavi-1.2.3-MacOS-Arm64.dmg") {
		t.Fatal("expected package path embedded in script")
	}
	if !strings.Contains(script, "/Applications/GoNavi.app") {
		t.Fatal("expected target app path embedded in script")
	}
	if !strings.Contains(script, "PID=4242") {
		t.Fatal("expected host pid embedded in script")
	}
}

func TestResolveMacUpdateTargetFallsBackFromAppTranslocation(t *testing.T) {
	got := resolveMacUpdateTarget("/private/var/folders/xx/AppTranslocation/ABC/d/GoNavi.app/Contents/MacOS/GoNavi")
	if got != "/Applications/GoNavi.app" {
		t.Fatalf("expected AppTranslocation fallback, got %q", got)
	}
	got = resolveMacUpdateTarget("/Applications/GoNavi.app/Contents/MacOS/GoNavi")
	if got != "/Applications/GoNavi.app" {
		t.Fatalf("expected normal app bundle path, got %q", got)
	}
}

// 管理员替换曾经写成 `osascript <<'EOF' arg1...`：没有 `-` 时 osascript 会把第一个参数
// 当成脚本文件名，报 -2740 语法错误后退出 1，内置 AppleScript 从不执行。
// 于是「无权限直接替换」这条唯一兜底路径必然失败。
func TestBuildMacScriptAdminReplacePassesStdinAndArgs(t *testing.T) {
	script := buildMacScript(
		"/tmp/GoNavi/updates/1.2.3/GoNavi-1.2.3-MacOS-Arm64.dmg",
		"/Applications/GoNavi.app",
		"/tmp/GoNavi/updates",
		"/tmp/GoNavi/updates/1.2.3/stage",
		"/tmp/GoNavi/updates/1.2.3/stage/mnt",
		"/tmp/GoNavi/updates/1.2.3/gonavi-update-macos.log",
		4242,
	)

	if !strings.Contains(script, `/usr/bin/osascript - "$APP_SRC"`) {
		t.Fatal("admin replace must pass `-` so osascript reads the AppleScript from stdin and the .app paths stay in argv")
	}
	// 裸形式（脚本体后面直接跟参数）会让 osascript 把第一个参数当脚本文件。
	for _, line := range strings.Split(script, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "/usr/bin/osascript") {
			continue
		}
		if !strings.Contains(trimmed, "osascript - ") {
			t.Fatalf("every osascript invocation must pass `-` before arguments, got: %s", trimmed)
		}
	}
	// 六个 argv 都要在内置脚本里被真正读取，否则授权命令会拼错路径。
	for _, item := range []string{
		"set srcPath to item 1 of argv",
		"set dstPath to item 2 of argv",
		"set tmpPath to item 3 of argv",
		"set bakPath to item 4 of argv",
		"set binRel to item 5 of argv",
		"set logPath to item 6 of argv",
	} {
		if !strings.Contains(script, item) {
			t.Fatalf("admin replace AppleScript missing %q", item)
		}
	}
}

// 挪走旧包失败时必须中止，否则新包会被塞进旧包内部，而旧包可执行文件仍在原位，
// 后续存在性校验照样通过 —— 表现为「更新成功但版本没变」。
func TestBuildMacScriptAbortsWhenExistingAppCannotBeMovedAside(t *testing.T) {
	script := buildMacScript(
		"/tmp/pkg.dmg",
		"/Applications/GoNavi.app",
		"/tmp/updates",
		"/tmp/updates/stage",
		"/tmp/updates/stage/mnt",
		"/tmp/updates/install.log",
		1,
	)

	if strings.Contains(script, "\n    /bin/mv \"$TARGET_APP\" \"$BACKUP_APP\" >>\"$LOG_FILE\" 2>&1\n") {
		t.Fatal("moving the existing app aside must be checked; an unchecked mv lets the new bundle nest inside the old one")
	}
	if !strings.Contains(script, `if ! /bin/mv "$TARGET_APP" "$BACKUP_APP"`) {
		t.Fatal("expected a guarded mv-aside with failure handling")
	}
	// 每个失败分支都必须先通知再退出，不能只写日志。
	failures := strings.Count(script, "notify_failure \"")
	if failures < 5 {
		t.Fatalf("expected every terminal failure path to notify the user, found %d notify_failure calls", failures)
	}
	for _, exitPath := range []string{
		"notify_failure \"无法从安装包中解出应用",
		"notify_failure \"无权限替换应用",
		"notify_failure \"替换后目标应用",
		"notify_failure \"应用已替换但自动重启失败",
	} {
		if !strings.Contains(script, exitPath) {
			t.Fatalf("missing user-visible failure notification %q", exitPath)
		}
	}
	// 通知必须在删除 updates 目录之前完成，否则日志路径失效。
	rmIdx := strings.Index(script, `exec /bin/rm -rf "$UPDATES_DIR"`)
	lastNotify := strings.LastIndex(script, "notify_failure \"")
	if rmIdx < 0 || lastNotify < 0 || lastNotify > rmIdx {
		t.Fatal("failure notifications must be emitted before the updates directory is removed")
	}
}
