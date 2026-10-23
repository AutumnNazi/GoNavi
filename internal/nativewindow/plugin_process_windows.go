//go:build windows

package nativewindow

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"GoNavi-Wails/internal/logger"

	"golang.org/x/sys/windows"
)

type pluginWindowsProcess struct {
	mu      sync.Mutex
	process windows.Handle
	job     windows.Handle
	pid     int
}

func startPluginProcess(spec pluginProcessSpec) (pluginProcess, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, fmt.Errorf("create plugin window job: %w", err)
	}
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		closePluginHandle(job)
		return nil, fmt.Errorf("configure plugin window job: %w", err)
	}
	process, err := createSuspendedPlugin(spec)
	if err != nil {
		closePluginHandle(job)
		return nil, err
	}
	if err := windows.AssignProcessToJobObject(job, process.Process); err != nil {
		terminateUnassignedPlugin(process)
		closePluginHandle(job)
		return nil, fmt.Errorf("assign plugin window job: %w", err)
	}
	if _, err := windows.ResumeThread(process.Thread); err != nil {
		terminateUnassignedPlugin(process)
		closePluginHandle(job)
		return nil, fmt.Errorf("resume plugin window: %w", err)
	}
	closePluginHandle(process.Thread)
	return &pluginWindowsProcess{process: process.Process, job: job, pid: int(process.ProcessId)}, nil
}

func createSuspendedPlugin(spec pluginProcessSpec) (windows.ProcessInformation, error) {
	application, err := windows.UTF16PtrFromString(spec.executable)
	if err != nil {
		return windows.ProcessInformation{}, err
	}
	args := append([]string{spec.executable}, spec.args...)
	for index, arg := range args {
		args[index] = syscall.EscapeArg(arg)
	}
	commandLine, err := windows.UTF16PtrFromString(strings.Join(args, " "))
	if err != nil {
		return windows.ProcessInformation{}, err
	}
	directory, err := windows.UTF16PtrFromString(spec.directory)
	if err != nil {
		return windows.ProcessInformation{}, err
	}
	environment := append([]string(nil), spec.env...)
	sort.Slice(environment, func(i, j int) bool { return strings.ToUpper(environment[i]) < strings.ToUpper(environment[j]) })
	env := make([]uint16, 0)
	for _, item := range environment {
		encoded, err := windows.UTF16FromString(item)
		if err != nil {
			return windows.ProcessInformation{}, err
		}
		env = append(env, encoded...)
	}
	env = append(env, 0)
	if len(env) == 1 {
		env = append(env, 0)
	}
	startup := windows.StartupInfo{Cb: uint32(unsafe.Sizeof(windows.StartupInfo{}))}
	process := windows.ProcessInformation{}
	// No inherited handles. Suspension closes the spawn-before-job-assignment race.
	flags := uint32(windows.CREATE_UNICODE_ENVIRONMENT | windows.CREATE_SUSPENDED | windows.CREATE_NEW_PROCESS_GROUP | windows.CREATE_NO_WINDOW)
	if err := windows.CreateProcess(application, commandLine, nil, nil, false, flags, &env[0], directory, &startup, &process); err != nil {
		return windows.ProcessInformation{}, fmt.Errorf("create plugin window process: %w", err)
	}
	return process, nil
}

func (p *pluginWindowsProcess) PID() int { return p.pid }

func (p *pluginWindowsProcess) Wait() error {
	result, err := windows.WaitForSingleObject(p.process, windows.INFINITE)
	if err != nil {
		return err
	}
	if result != windows.WAIT_OBJECT_0 {
		return errors.New("unexpected plugin process wait result")
	}
	var exitCode uint32
	exitErr := windows.GetExitCodeProcess(p.process, &exitCode)
	p.mu.Lock()
	// Also reap browser descendants when the native window closes voluntarily.
	if err := windows.TerminateJobObject(p.job, 1); err != nil {
		logger.Error(err, "terminate remaining plugin window descendants")
	}
	closePluginHandle(p.job)
	p.job = 0
	closePluginHandle(p.process)
	p.process = 0
	p.mu.Unlock()
	if exitErr != nil {
		return exitErr
	}
	if exitCode != 0 {
		return fmt.Errorf("plugin window exited with code %d", exitCode)
	}
	return nil
}

func (p *pluginWindowsProcess) Kill() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.job == 0 {
		return nil
	}
	return windows.TerminateJobObject(p.job, 1)
}

func terminateUnassignedPlugin(process windows.ProcessInformation) {
	if err := windows.TerminateProcess(process.Process, 1); err != nil {
		logger.Error(err, "terminate failed plugin window launch")
	}
	if _, err := windows.WaitForSingleObject(process.Process, windows.INFINITE); err != nil {
		logger.Error(err, "reap failed plugin window launch")
	}
	closePluginHandle(process.Thread)
	closePluginHandle(process.Process)
}

func closePluginHandle(handle windows.Handle) {
	if handle != 0 {
		if err := windows.CloseHandle(handle); err != nil {
			logger.Error(err, "close plugin window handle")
		}
	}
}
