//go:build windows

package codex

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

// applyProbeSysAttr 隐藏探测命令的控制台窗口：Windows 上运行 .cmd 会
// 弹出可见终端，用户每步操作都会被闪屏干扰（实测反馈）。
func applyProbeSysAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NO_WINDOW,
	}
}
