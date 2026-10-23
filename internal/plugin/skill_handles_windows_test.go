package plugin

import (
	"encoding/binary"
	"errors"
	"os"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func createSkillDirectoryLink(t *testing.T, link, target string) {
	t.Helper()
	if err := os.Mkdir(link, 0700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(link) })
	substitute, err := windows.UTF16FromString(`\??\` + target)
	if err != nil {
		t.Fatal(err)
	}
	printName, err := windows.UTF16FromString(target)
	if err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, 16+2*(len(substitute)+len(printName)))
	binary.LittleEndian.PutUint32(buffer, windows.IO_REPARSE_TAG_MOUNT_POINT)
	binary.LittleEndian.PutUint16(buffer[4:], uint16(len(buffer)-8))
	binary.LittleEndian.PutUint16(buffer[10:], uint16((len(substitute)-1)*2))
	binary.LittleEndian.PutUint16(buffer[12:], uint16(len(substitute)*2))
	binary.LittleEndian.PutUint16(buffer[14:], uint16((len(printName)-1)*2))
	for index, value := range append(substitute, printName...) {
		binary.LittleEndian.PutUint16(buffer[16+index*2:], value)
	}
	name, err := windows.UTF16PtrFromString(link)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_WRITE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)
	var returned uint32
	if err = windows.DeviceIoControl(handle, windows.FSCTL_SET_REPARSE_POINT, &buffer[0], uint32(len(buffer)), nil, 0, &returned, nil); err != nil {
		t.Fatalf("create junction: %v", err)
	}
}

func skillTestHandleCount(t *testing.T) uint32 {
	t.Helper()
	var count uint32
	procedure := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetProcessHandleCount")
	ok, _, err := procedure.Call(uintptr(windows.CurrentProcess()), uintptr(unsafe.Pointer(&count)))
	if ok == 0 {
		t.Fatal(err)
	}
	return count
}

func assertSkillHandleClosed(t *testing.T, handle uintptr) {
	t.Helper()
	var flags uint32
	procedure := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetHandleInformation")
	ok, _, err := procedure.Call(handle, uintptr(unsafe.Pointer(&flags)))
	if ok != 0 || !errors.Is(err, windows.ERROR_INVALID_HANDLE) {
		t.Fatalf("closed native handle remained usable: %v", err)
	}
}

// A retained read handle must make a share=0 open fail, independently of Thread/Event objects.
func assertSkillHeldHandleDetected(t *testing.T, path string, _ uintptr) {
	t.Helper()
	if err := probeSkillExclusiveRead(path); !errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
		t.Fatalf("retained read handle escaped exclusive probe: %v", err)
	}
}

func assertSkillRejectedOpenReleased(t *testing.T, path string, _ uint32) {
	t.Helper()
	if err := probeSkillExclusiveRead(path); err != nil {
		t.Fatalf("rejected open retained file access: %v", err)
	}
}

func probeSkillExclusiveRead(path string) error {
	name, err := windows.UTF16PtrFromString(extendedPackagePath(path))
	if err != nil {
		return err
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, 0, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return err
	}
	return windows.CloseHandle(handle)
}

func TestSkillStorageWindowsShortPathAlias(t *testing.T) {
	target := t.TempDir()
	input, err := windows.UTF16PtrFromString(target)
	if err != nil {
		t.Fatal(err)
	}
	output := make([]uint16, 32768)
	size, err := windows.GetShortPathName(input, &output[0], uint32(len(output)))
	if err != nil {
		t.Fatal(err)
	}
	short := windows.UTF16ToString(output[:size])
	manager := managerAt(t, short)
	if manager.root != canonicalSkillPath(t, target) {
		t.Fatalf("8.3 alias changed canonical root: %q", manager.root)
	}
}
