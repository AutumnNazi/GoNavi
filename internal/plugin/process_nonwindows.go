//go:build !windows

package plugin

import (
	"errors"
	"os/exec"
	"syscall"
)

type processTree struct{ pid int }

func startProcessTree(cmd *exec.Cmd) (*processTree, error) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &processTree{pid: cmd.Process.Pid}, nil
}
func (t *processTree) kill() error {
	err := syscall.Kill(-t.pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}
func (t *processTree) close() error { return nil }
