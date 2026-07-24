//go:build windows

package app

import (
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const windowsCreateNoWindow = 0x08000000

const (
	windowsCloseMessage              = 0x0010
	windowsGracefulProcessCloseWait  = 1500 * time.Millisecond
	windowsForcedProcessCloseTimeout = 10 * time.Second
)

var windowsPostMessage = windows.NewLazySystemDLL("user32.dll").NewProc("PostMessageW")

func configureWindowsUpdateCommand(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windowsCreateNoWindow,
	}
}

func findOtherWindowsUpdateInstances(targetPaths []string, currentPID int) ([]windowsUpdateProcess, error) {
	targets := make(map[string]struct{}, len(targetPaths)*2)
	targetNames := make(map[string]struct{}, len(targetPaths))
	for _, targetPath := range targetPaths {
		addWindowsUpdateComparablePath(targets, targetPath)
		if name := strings.ToLower(filepath.Base(strings.TrimSpace(targetPath))); name != "" && name != "." {
			targetNames[name] = struct{}{}
		}
	}
	if len(targets) == 0 {
		return nil, nil
	}

	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, fmt.Errorf("enumerate running processes: %w", err)
	}
	defer windows.CloseHandle(snapshot)

	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	if err := windows.Process32First(snapshot, &entry); err != nil {
		if errors.Is(err, windows.ERROR_NO_MORE_FILES) {
			return nil, nil
		}
		return nil, fmt.Errorf("read running processes: %w", err)
	}

	result := make([]windowsUpdateProcess, 0, 2)
	for {
		pid := entry.ProcessID
		if pid != 0 && int(pid) != currentPID {
			executable, queryErr := queryWindowsProcessExecutable(pid)
			if queryErr == nil && windowsUpdatePathMatches(targets, executable) {
				result = append(result, windowsUpdateProcess{PID: pid, Executable: executable})
			} else if queryErr != nil && !errors.Is(queryErr, windows.ERROR_INVALID_PARAMETER) {
				entryName := strings.ToLower(windows.UTF16ToString(entry.ExeFile[:]))
				if _, mayBeTarget := targetNames[entryName]; mayBeTarget {
					return nil, fmt.Errorf("inspect possible GoNavi process %d (%s): %w", pid, entryName, queryErr)
				}
			}
		}

		if err := windows.Process32Next(snapshot, &entry); err != nil {
			if errors.Is(err, windows.ERROR_NO_MORE_FILES) {
				break
			}
			return nil, fmt.Errorf("read running processes: %w", err)
		}
	}
	return result, nil
}

func closeWindowsUpdateInstances(processes []windowsUpdateProcess) error {
	unique := make(map[uint32]windowsUpdateProcess, len(processes))
	for _, process := range processes {
		if process.PID != 0 {
			unique[process.PID] = process
		}
	}
	if len(unique) == 0 {
		return nil
	}

	opened, err := openWindowsUpdateProcesses(unique)
	if err != nil {
		return err
	}
	defer func() {
		for _, process := range opened {
			windows.CloseHandle(process.handle)
		}
	}()
	if len(opened) == 0 {
		return nil
	}

	openedByPID := make(map[uint32]windowsUpdateProcess, len(opened))
	for _, process := range opened {
		openedByPID[process.process.PID] = process.process
	}
	requestWindowsProcessesClose(openedByPID)
	var closeErrors []error
	for _, process := range opened {
		if err := closeWindowsUpdateProcess(process); err != nil {
			closeErrors = append(closeErrors, err)
		}
	}
	return errors.Join(closeErrors...)
}

func requestWindowsProcessesClose(processes map[uint32]windowsUpdateProcess) {
	callback := syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		var pid uint32
		if _, err := windows.GetWindowThreadProcessId(windows.HWND(hwnd), &pid); err == nil {
			if _, ok := processes[pid]; ok {
				windowsPostMessage.Call(hwnd, windowsCloseMessage, 0, 0)
			}
		}
		return 1
	})
	_ = windows.EnumWindows(callback, nil)
}

type openedWindowsUpdateProcess struct {
	process windowsUpdateProcess
	handle  windows.Handle
}

func openWindowsUpdateProcesses(processes map[uint32]windowsUpdateProcess) ([]openedWindowsUpdateProcess, error) {
	opened := make([]openedWindowsUpdateProcess, 0, len(processes))
	for _, process := range processes {
		handle, err := windows.OpenProcess(
			windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.PROCESS_TERMINATE|windows.SYNCHRONIZE,
			false,
			process.PID,
		)
		if err != nil {
			if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
				continue
			}
			for _, item := range opened {
				windows.CloseHandle(item.handle)
			}
			return nil, fmt.Errorf("open GoNavi process %d (%s): %w", process.PID, process.Executable, err)
		}

		actualExecutable, queryErr := queryWindowsProcessExecutableFromHandle(handle)
		if queryErr != nil {
			windows.CloseHandle(handle)
			for _, item := range opened {
				windows.CloseHandle(item.handle)
			}
			return nil, fmt.Errorf("verify GoNavi process %d (%s): %w", process.PID, process.Executable, queryErr)
		}
		expectedPaths := make(map[string]struct{}, 2)
		addWindowsUpdateComparablePath(expectedPaths, process.Executable)
		if !windowsUpdatePathMatches(expectedPaths, actualExecutable) {
			windows.CloseHandle(handle)
			for _, item := range opened {
				windows.CloseHandle(item.handle)
			}
			return nil, fmt.Errorf(
				"GoNavi process %d executable changed from %s to %s",
				process.PID,
				process.Executable,
				actualExecutable,
			)
		}
		opened = append(opened, openedWindowsUpdateProcess{process: process, handle: handle})
	}
	return opened, nil
}

func closeWindowsUpdateProcess(opened openedWindowsUpdateProcess) error {
	process := opened.process
	handle := opened.handle

	event, err := windows.WaitForSingleObject(handle, uint32(windowsGracefulProcessCloseWait.Milliseconds()))
	if err != nil {
		return fmt.Errorf("wait for GoNavi process %d to close: %w", process.PID, err)
	}
	if event == windows.WAIT_OBJECT_0 {
		return nil
	}
	if event != uint32(windows.WAIT_TIMEOUT) {
		return fmt.Errorf("wait for GoNavi process %d returned status %#x", process.PID, event)
	}

	if err := windows.TerminateProcess(handle, 0); err != nil {
		return fmt.Errorf("terminate GoNavi process %d (%s): %w", process.PID, process.Executable, err)
	}
	event, err = windows.WaitForSingleObject(handle, uint32(windowsForcedProcessCloseTimeout.Milliseconds()))
	if err != nil {
		return fmt.Errorf("wait for terminated GoNavi process %d: %w", process.PID, err)
	}
	if event != windows.WAIT_OBJECT_0 {
		return fmt.Errorf("GoNavi process %d did not exit after termination", process.PID)
	}
	return nil
}

func queryWindowsProcessExecutable(pid uint32) (string, error) {
	process, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(process)
	return queryWindowsProcessExecutableFromHandle(process)
}

func queryWindowsProcessExecutableFromHandle(process windows.Handle) (string, error) {
	buffer := make([]uint16, windows.MAX_LONG_PATH)
	size := uint32(len(buffer))
	if err := windows.QueryFullProcessImageName(process, 0, &buffer[0], &size); err != nil {
		return "", err
	}
	if size == 0 {
		return "", errors.New("process executable path is empty")
	}
	return windows.UTF16ToString(buffer[:size]), nil
}

func windowsUpdatePathMatches(targets map[string]struct{}, executable string) bool {
	paths := make(map[string]struct{}, 2)
	addWindowsUpdateComparablePath(paths, executable)
	for path := range paths {
		if _, ok := targets[path]; ok {
			return true
		}
	}
	return false
}

func addWindowsUpdateComparablePath(paths map[string]struct{}, path string) {
	path = strings.TrimSpace(path)
	if path == "" {
		return
	}
	path = strings.TrimPrefix(path, `\\?\`)
	if absolute, err := filepath.Abs(path); err == nil {
		path = absolute
	}
	path = strings.ToLower(filepath.Clean(path))
	paths[path] = struct{}{}

	if evaluated, err := filepath.EvalSymlinks(path); err == nil {
		paths[strings.ToLower(filepath.Clean(evaluated))] = struct{}{}
	}
}
