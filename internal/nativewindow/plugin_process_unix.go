//go:build linux || darwin

package nativewindow

import (
	"errors"
	"os/exec"
	"syscall"

	"GoNavi-Wails/internal/logger"
)

type pluginUnixProcess struct{ command *exec.Cmd }

func startPluginProcess(spec pluginProcessSpec) (pluginProcess, error) {
	command := exec.Command(spec.executable, spec.args...)
	command.Env = spec.env
	command.Dir = spec.directory
	command.SysProcAttr = pluginProcessAttributes()
	// No host stdin/stdout/stderr descriptors are inherited by arbitrary UI code.
	if err := command.Start(); err != nil {
		return nil, err
	}
	return &pluginUnixProcess{command: command}, nil
}

func (p *pluginUnixProcess) PID() int { return p.command.Process.Pid }

func (p *pluginUnixProcess) Wait() error {
	err := p.command.Wait()
	if killErr := p.Kill(); killErr != nil {
		logger.Error(killErr, "terminate remaining plugin window process group")
	}
	return err
}

func (p *pluginUnixProcess) Kill() error {
	err := syscall.Kill(-p.command.Process.Pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}
