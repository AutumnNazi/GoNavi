package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The MSI install-time brand icon restore ships as a standalone PowerShell
// file next to installer.wxs. These tests keep its contract aligned with the
// Go data-root resolution (internal/appdata) and the embedded shortcut repair
// script, so a reinstall keeps restoring the persisted selection.
func readWindowsInstallerBrandIconScript(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "build", "windows", "apply-brand-icon.ps1"))
	if err != nil {
		t.Fatalf("read installer brand icon script: %v", err)
	}
	return string(data)
}

func TestWindowsInstallerBrandIconScriptMirrorsDataRootResolution(t *testing.T) {
	script := readWindowsInstallerBrandIconScript(t)
	for _, token := range []string{
		// Data root: default <USERPROFILE>\.gonavi, redirectable through the
		// bootstrap file's dataRoot field (internal/appdata/root.go).
		`'.gonavi'`,
		`storage_root.json`,
		`dataRoot`,
		// Brand state pointer. The pointer is the only authority: legacy
		// content-addressed ICO files must never be guessed from (they are
		// never pruned and survive uninstall, so guessing resurrects an icon
		// the user never selected). Mirrors the Go loader.
		`active-icon.txt`,
		`$iconName = $candidate`,
		// The profile is derived from the AppDataFolder property because the
		// deferred action runs as SYSTEM.
		`$ApplicationDataFolder`,
		`[IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($appDataRoot))`,
	} {
		if !strings.Contains(script, token) {
			t.Fatalf("installer brand icon script missing %q:\n%s", token, script)
		}
	}
}

// 回归防线：安装期不得再按修改时间挑最新的 gonavi-brand-*.ico。内容寻址 ICO
// 从不清理、卸载也刻意保留，猜测会把用户从未选择过的图标（旧版默认吉祥物）
// 恢复到新建快捷方式上，而应用内选择器仍显示默认值——这正是用户报告的现象，
// 且因为安装器早于首次启动运行而更难诊断。只检查可执行代码行，注释（含本
// 契约的说明文字）不参与判定。
func TestWindowsInstallerBrandIconScriptNeverGuessesFromResidualIcons(t *testing.T) {
	script := readWindowsInstallerBrandIconScript(t)
	var code strings.Builder
	for _, line := range strings.Split(script, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		code.WriteString(line)
		code.WriteString("\n")
	}
	executable := code.String()
	for _, forbidden := range []string{
		// The residual ICO glob and the mtime ordering that turned it into a
		// "current selection" guess.
		`gonavi-brand-*.ico`,
		`LastWriteTime`,
		`Sort-Object`,
	} {
		if strings.Contains(executable, forbidden) {
			t.Fatalf("installer brand icon script must not guess an icon from residual ICO files, found %q in executable code:\n%s", forbidden, executable)
		}
	}
	// The icon name may only ever come from active-icon.txt, never from a
	// directory scan.
	if strings.Contains(executable, `-Filter 'gonavi-brand`) {
		t.Fatalf("installer brand icon script must resolve the icon from active-icon.txt only:\n%s", executable)
	}
}

func TestWindowsInstallerBrandIconScriptAppliesShortcutIconSafely(t *testing.T) {
	script := readWindowsInstallerBrandIconScript(t)
	for _, token := range []string{
		// MSI writes the AppUserModel property bag on its shortcuts; a
		// WScript.Shell save or replacement drops it, so the relaunch
		// identity must be restored with the ID (pid 5) written last.
		`new PROPERTYKEY(PKEY_AppUserModel, 2), "\"" + targetPath + "\"")`,
		`new PROPERTYKEY(PKEY_AppUserModel, 3), iconPath)`,
		`new PROPERTYKEY(PKEY_AppUserModel, 4), "GoNavi")`,
		`new PROPERTYKEY(PKEY_AppUserModel, 5), applicationUserModelID)`,
		// The Start menu ignores in-place IconLocation rewrites; the shortcut
		// must be replaced as a whole file, with leftovers of a killed run
		// cleaned up on the next install.
		`-gonavi-apply-`,
		`Move-Item -LiteralPath $replacementPath -Destination $shortcutPath -Force`,
		`'*-gonavi-apply-*.lnk'`,
	} {
		if !strings.Contains(script, token) {
			t.Fatalf("installer brand icon script missing %q:\n%s", token, script)
		}
	}
	pid2 := strings.Index(script, `new PROPERTYKEY(PKEY_AppUserModel, 2), "\"" + targetPath + "\"")`)
	pid3 := strings.Index(script, `new PROPERTYKEY(PKEY_AppUserModel, 3), iconPath)`)
	pid4 := strings.Index(script, `new PROPERTYKEY(PKEY_AppUserModel, 4), "GoNavi")`)
	pid5 := strings.Index(script, `new PROPERTYKEY(PKEY_AppUserModel, 5), applicationUserModelID)`)
	if !(pid2 < pid3 && pid3 < pid4 && pid4 < pid5) {
		t.Fatalf("relaunch properties must be written before AppUserModel.ID:\n%s", script)
	}
}

// ACL 收敛契约：整文件替换机器层快捷方式会让新文件继承目录 ACL，静默丢掉
// GrantUsersModify 自定义动作授予的每文件 Users-Modify 权限；运行时修复脚
// 本对标准用户只读的机器层快捷方式按硬失败处理（下一次应用内切换直接报
// 错）。安装侧的重写必须在仍以 SYSTEM 运行时自行补回授权。
func TestWindowsInstallerBrandIconScriptRestoresUsersModifyGrant(t *testing.T) {
	script := readWindowsInstallerBrandIconScript(t)
	for _, token := range []string{
		`function Restore-GoNaviShortcutUserModifyGrant`,
		// Same well-known SID form (BUILTIN\Users) as the GrantUsersModify
		// custom actions in installer.wxs, quoted so PowerShell passes it
		// through literally.
		`'*S-1-5-32-545:M'`,
		`Restore-GoNaviShortcutUserModifyGrant -ShortcutPath $shortcutPath`,
	} {
		if !strings.Contains(script, token) {
			t.Fatalf("installer brand icon script missing %q:\n%s", token, script)
		}
	}
	grantCall := strings.Index(script, `Restore-GoNaviShortcutUserModifyGrant -ShortcutPath $shortcutPath`)
	relaunchCall := strings.Index(script, `Set-GoNaviShortcutRelaunchProperties -ShortcutPath $shortcutPath -TargetPath $targetPath`)
	if grantCall < 0 || relaunchCall < 0 || grantCall > relaunchCall {
		t.Fatalf("ACL grant must be restored before the relaunch-property restore, whose failure path skips the iteration:\n%s", script)
	}
}

// 卸载清理契约：移除启动期迁移到用户层的开始菜单快捷方式与指向卸载目标
// 的任务栏固定项；外来/存活的快捷方式必须保留，死固定项还要求图标归属证
// 据（位于用户品牌图标目录内）才能认领删除。
func TestWindowsInstallerBrandIconScriptUninstallCleanup(t *testing.T) {
	script := readWindowsInstallerBrandIconScript(t)
	for _, token := range []string{
		`[switch]$UninstallCleanup`,
		`function Remove-GoNaviUserShortcutsForUninstall`,
		`GoNavi*.lnk`,
		`User Pinned\TaskBar`,
		`Start Menu\Programs`,
		// Ownership evidence for dead pins: icon inside the user's
		// brand-icon directory (same rule as the runtime repair script).
		`'.gonavi\application-icons'`,
		`$ownedIconPrefix`,
		// The all-apps list only rebuilds when its host restarts.
		`StartMenuExperienceHost`,
		`uninstall removed GoNavi shortcut`,
	} {
		if !strings.Contains(script, token) {
			t.Fatalf("installer uninstall cleanup missing %q:\n%s", token, script)
		}
	}
	// The cleanup branch must run before the install flow and exit.
	uninstallIndex := strings.Index(script, "if ($UninstallCleanup) {")
	installIndex := strings.Index(script, `$iconDir = [IO.Path]::Combine($activeRoot, 'application-icons')`)
	if uninstallIndex < 0 || installIndex < 0 || uninstallIndex > installIndex {
		t.Fatalf("uninstall cleanup dispatch must precede the install flow\n%s", script)
	}
}

func TestWindowsInstallerBrandIconScriptStaysPowerShell51Safe(t *testing.T) {
	script := readWindowsInstallerBrandIconScript(t)
	// Windows PowerShell 5.1 only allows Split-Path -LiteralPath together
	// with -Resolve; -Parent/-Leaf throw AmbiguousParameterSet at runtime
	// (silently swallowed by catch blocks).
	if strings.Contains(script, "Split-Path -LiteralPath") {
		t.Fatalf("PowerShell 5.1-incompatible Split-Path usage found:\n%s", script)
	}
	// Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI; ASCII-only keeps
	// every code page identical.
	for _, r := range script {
		if r > 0x7f {
			t.Fatalf("installer brand icon script must remain ASCII-only, found %q", r)
		}
	}
}
