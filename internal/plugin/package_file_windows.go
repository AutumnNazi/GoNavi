package plugin

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Canonicalize user-chosen ancestors once through the kernel. Later reads always use no-follow handles.
func canonicalPackageDirectory(path string) (string, error) { return canonicalPackagePath(path, true) }
func canonicalStorageRoot(path string) (string, error)      { return canonicalPackagePath(path, false) }

func canonicalPackagePath(path string, allowFinalLink bool) (string, error) {
	name, err := windows.UTF16PtrFromString(extendedPackagePath(path))
	if err != nil {
		return "", err
	}
	flags := uint32(windows.FILE_FLAG_BACKUP_SEMANTICS)
	if !allowFinalLink {
		flags |= windows.FILE_FLAG_OPEN_REPARSE_POINT
	}
	handle, err := windows.CreateFile(name, windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, flags, 0)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(handle)
	var info windows.ByHandleFileInformation
	if err = windows.GetFileInformationByHandle(handle, &info); err != nil {
		return "", err
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 || (!allowFinalLink && info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0) {
		return "", fmt.Errorf("plugin root is a link, reparse point or non-directory")
	}
	buffer := make([]uint16, 32768)
	size, err := windows.GetFinalPathNameByHandle(handle, &buffer[0], uint32(len(buffer)), 0)
	if err != nil {
		return "", err
	}
	if size == 0 || size >= uint32(len(buffer)) {
		return "", fmt.Errorf("canonical package path exceeds limit")
	}
	resolved := windows.UTF16ToString(buffer[:size])
	// Preserve extended syntax for long paths so other Win32 state/rename APIs retain support.
	if len(resolved) >= 248 {
		return filepath.Clean(resolved), nil
	}
	if strings.HasPrefix(resolved, `\\?\UNC\`) {
		resolved = `\\` + strings.TrimPrefix(resolved, `\\?\UNC\`)
	} else if strings.HasPrefix(resolved, `\\?\`) && len(resolved) >= 7 && resolved[5] == ':' {
		resolved = resolved[4:]
	}
	return filepath.Clean(resolved), nil
}

func extendedPackagePath(path string) string {
	if strings.HasPrefix(path, `\\?\`) {
		return path
	}
	if strings.HasPrefix(path, `\\`) {
		return `\\?\UNC\` + strings.TrimPrefix(path, `\\`)
	}
	return `\\?\` + path
}

func openPackageVolumeRoot(path string, readContent bool) (*os.File, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	access := uint32(windows.FILE_READ_ATTRIBUTES | windows.FILE_TRAVERSE | windows.SYNCHRONIZE)
	if readContent {
		access = windows.FILE_GENERIC_READ
	}
	handle, err := windows.CreateFile(name, access, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(handle), path)
	if err = validatePackageHandle(handle); err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}

func openPackageChildHandle(parent *os.File, name string, readContent bool) (*os.File, error) {
	objectName, err := windows.NewNTUnicodeString(name)
	if err != nil {
		return nil, err
	}
	attributes := windows.OBJECT_ATTRIBUTES{RootDirectory: windows.Handle(parent.Fd()), ObjectName: objectName, Attributes: windows.OBJ_CASE_INSENSITIVE | windows.OBJ_DONT_REPARSE}
	attributes.Length = uint32(unsafe.Sizeof(attributes))
	access := uint32(windows.FILE_READ_ATTRIBUTES | windows.FILE_TRAVERSE | windows.SYNCHRONIZE)
	options := uint32(windows.FILE_OPEN_REPARSE_POINT | windows.FILE_SYNCHRONOUS_IO_NONALERT | windows.FILE_COMPLETE_IF_OPLOCKED)
	if readContent {
		access = windows.FILE_GENERIC_READ
	} else {
		options |= windows.FILE_DIRECTORY_FILE
	}
	var handle windows.Handle
	var status windows.IO_STATUS_BLOCK
	err = windows.NtCreateFile(&handle, access, &attributes, &status, nil, 0, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, windows.FILE_OPEN, options, 0, 0)
	runtime.KeepAlive(parent)
	if err != nil {
		if handle != 0 && handle != windows.InvalidHandle {
			windows.CloseHandle(handle)
		}
		return nil, err
	}
	file := os.NewFile(uintptr(handle), filepath.Join(parent.Name(), name))
	if err = validatePackageHandle(handle); err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}

func validatePackageHandle(handle windows.Handle) error {
	kind, err := windows.GetFileType(handle)
	if err != nil {
		return err
	}
	if kind != windows.FILE_TYPE_DISK {
		return fmt.Errorf("package contains non-disk object")
	}
	var info windows.ByHandleFileInformation
	if err = windows.GetFileInformationByHandle(handle, &info); err != nil {
		return err
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || (info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 && info.NumberOfLinks != 1) {
		return fmt.Errorf("package contains link or reparse point")
	}
	return nil
}
