//go:build windows

package app

import (
	"context"
	"fmt"
	"strings"
)

// Injectable so the never-selected startup path can be tested without migrating
// shortcuts on the developer's own machine.
var windowsRepairDefaultApplicationShortcuts = repairDefaultWindowsApplicationShortcuts

// applyPersistedWindowsApplicationIcon binds the last selected ICO before
// Wails shows the first window. The frontend state is hydrated too late to be
// the first source of truth for the Windows taskbar button.
func applyPersistedWindowsApplicationIcon(runtimeContext context.Context, configDir string) error {
	removeStaleWindowsShortcutUpdateScripts(configDir)
	removeStaleWindowsShortcutReplacementFiles()
	iconPath, err := loadPersistedWindowsApplicationIcon(configDir)
	if err != nil {
		return err
	}
	if strings.TrimSpace(iconPath) == "" {
		// 从未切换过品牌图标也要在启动时把机器层快捷方式收敛到用户层：
		// 安装器授予的单文件 Users-Modify 修改权是跨用户篡改面，迁移完成
		// 即关闭；MSI 修复/升级重建机器层条目后，下次启动再次迁移，其他
		// 用户的开始菜单入口也借此自愈。后台执行，失败不阻塞启动。
		// 没有有效选择记录时只迁移快捷方式，不从残留 ICO 猜测图标。
		go windowsRepairDefaultApplicationShortcuts()
		return clearPersistedWindowsApplicationIcon(configDir)
	}
	// 每次启动都幂等执行固定项修复：没有一次性标记，失败（文件被占用、
	// Explorer 重启等）总会在下次启动重试。
	repairPersistedWindowsApplicationShortcuts(iconPath)
	// On startup the taskbar button is created after Wails shows the window.
	// Re-registering it here only creates a visible delete/add cycle; the
	// shortcut and WM_SETICON sources are already updated before first show.
	// The shortcut already carries the persisted icon. Explorer resolves it
	// while creating the taskbar button, so startup does not need the global
	// association broadcast used by a live brand switch.
	_, _, err = setCurrentWindowsApplicationIconMode(runtimeContext, iconPath, false)
	if err != nil {
		return err
	}
	// 监视任务栏固定项变化（用户固定/取消固定），变化后重应用当前品牌
	// 图标：取消固定会让按钮失去图标来源（Explorer 不重采样窗口图标），
	// 需要一次完整的重应用链路才能恢复显示。
	startWindowsPinsWatcher(runtimeContext, configDir)
	// A selected legacy icon may have been normalized to a new candidate.
	// Commit its path only after the native window has been restored.
	if err := activatePersistedWindowsApplicationIcon(iconPath, configDir); err != nil {
		return fmt.Errorf("persist active Windows application icon: %w", err)
	}
	return nil
}
