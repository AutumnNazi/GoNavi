//go:build windows

package app

import (
	"errors"
	"strings"

	"golang.org/x/sys/windows"
)

// pluginExportFinalPath follows directory junctions using the kernel handle.
// EvalSymlinks alone can preserve a junction's lexical alias on Windows.
func pluginExportFinalPath(path string) (string, error) {
	encoded, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return "", err
	}
	handle, err := windows.CreateFile(encoded, windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return "", err
	}
	resolved, resolveErr := pluginExportHandlePath(handle)
	closeErr := windows.CloseHandle(handle)
	if err := errors.Join(resolveErr, closeErr); err != nil {
		return "", err
	}
	if len(resolved) >= 8 && strings.EqualFold(resolved[:8], `\\?\UNC\`) {
		return `\\` + resolved[8:], nil
	}
	if len(resolved) >= 7 && strings.HasPrefix(resolved, `\\?\`) && resolved[5] == ':' {
		return resolved[4:], nil
	}
	return resolved, nil
}

func pluginExportHandlePath(handle windows.Handle) (string, error) {
	buffer := make([]uint16, 1024)
	length, err := windows.GetFinalPathNameByHandle(handle, &buffer[0], uint32(len(buffer)), 0)
	if err != nil {
		return "", err
	}
	if length >= uint32(len(buffer)) {
		if length > 65535 {
			return "", errors.New("canonical export path exceeds limit")
		}
		buffer = make([]uint16, int(length)+1)
		length, err = windows.GetFinalPathNameByHandle(handle, &buffer[0], uint32(len(buffer)), 0)
		if err != nil {
			return "", err
		}
	}
	if length == 0 || length >= uint32(len(buffer)) {
		return "", errors.New("canonical export path is invalid")
	}
	return windows.UTF16ToString(buffer[:length]), nil
}
