package sessionassets

import (
	"context"
)

// TerminalLauncher 在系统终端中启动一条 codex 命令。入口启动只代表
// “入口已启动”，不代表会话创建或轮次执行成功（交接结果分级）。
// 平台实现见 launch_windows.go / launch_darwin.go / launch_other.go。

// LaunchTerminal 启动系统终端承载交互式 codex 命令；workDir 为空时
// 使用终端默认目录。
func LaunchTerminal(ctx context.Context, command, workDir string) error {
	return launchTerminalPlatform(ctx, command, workDir)
}
