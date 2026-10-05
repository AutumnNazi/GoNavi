//go:build darwin

package sessionassets

import (
	"context"
	"os/exec"
)

// launchTerminalDarwin 通过 Terminal.app 执行命令。
func launchTerminalPlatform(ctx context.Context, command, workDir string) error {
	script := "do script \"" + command + "\""
	cmd := exec.CommandContext(ctx, "osascript", "-e", "tell application \"Terminal\" to "+script)
	if workDir != "" {
		cmd.Dir = workDir
	}
	return cmd.Start()
}
