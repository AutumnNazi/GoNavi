//go:build !windows && !darwin

package sessionassets

import (
	"context"
	"os/exec"
)

// linuxTerminalCandidates 是常见终端模拟器的探测顺序。
var linuxTerminalCandidates = []string{"x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"}

// launchTerminalPlatform 探测可用终端模拟器启动交互命令；找不到时
// 退化为分离进程（无交互界面，仅尽力）。
func launchTerminalPlatform(ctx context.Context, command, workDir string) error {
	for _, candidate := range linuxTerminalCandidates {
		if path, err := exec.LookPath(candidate); err == nil {
			cmd := exec.CommandContext(ctx, path, "--", "sh", "-c", command)
			cmd.Dir = workDir
			return cmd.Start()
		}
	}
	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	cmd.Dir = workDir
	return cmd.Start()
}
