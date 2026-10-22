package main

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"syscall"
)

func staticWindowsNativePath(path string) string {
	if strings.HasPrefix(path, `\\?\`) {
		return path
	}
	if strings.HasPrefix(path, `\\`) {
		return `\\?\UNC\` + strings.TrimPrefix(path, `\\`)
	}
	return `\\?\` + path
}

func openStaticFile(path string) (*os.File, error) {
	name, err := syscall.UTF16PtrFromString(staticWindowsNativePath(path))
	if err != nil {
		return nil, err
	}
	handle, err := syscall.CreateFile(name, syscall.GENERIC_READ, syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE, nil, syscall.OPEN_EXISTING, syscall.FILE_FLAG_OPEN_REPARSE_POINT|syscall.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return nil, os.NewSyscallError("open static entry", err)
	}
	var info syscall.ByHandleFileInformation
	if err = syscall.GetFileInformationByHandle(handle, &info); err != nil {
		return nil, errors.Join(err, syscall.CloseHandle(handle))
	}
	if info.FileAttributes&(syscall.FILE_ATTRIBUTE_REPARSE_POINT|syscall.FILE_ATTRIBUTE_DIRECTORY) != 0 {
		return nil, errors.Join(fmt.Errorf("static entry handle is not a regular non-reparse file"), syscall.CloseHandle(handle))
	}
	return os.NewFile(uintptr(handle), path), nil
}
