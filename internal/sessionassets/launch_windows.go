//go:build windows

package sessionassets

import (
	"context"
	"os/exec"
)

// launchTerminalWindows 用 start 打开新的控制台窗口承载交互式 CLI。
// start 的第一个带引号参数是窗口标题，命令本身不带凭据。
func launchTerminalPlatform(ctx context.Context, command, workDir string) error {
	cmd := exec.CommandContext(ctx, "cmd", "/c", "start", "GoNavi", command)
	if workDir != "" {
		cmd.Dir = workDir
	}
	return cmd.Start()
}
