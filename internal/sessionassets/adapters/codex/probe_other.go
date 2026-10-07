//go:build !windows

package codex

import "os/exec"

// applyProbeSysAttr 非 Windows 平台无控制台闪屏问题，空实现。
func applyProbeSysAttr(cmd *exec.Cmd) {}
