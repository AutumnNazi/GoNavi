//go:build windows

package app

import (
	"fmt"
	"os"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestAcquireWindowsUpdateMaintenanceBlocksUntilRelease(t *testing.T) {
	name := fmt.Sprintf(`Global\GoNavi-Update-Test-%d-%d`, os.Getpid(), time.Now().UnixNano())
	lease, err := acquireWindowsUpdateMaintenanceObject(name)
	if err != nil {
		t.Fatalf("acquire maintenance object: %v", err)
	}
	t.Cleanup(lease.Release)
	if active, err := windowsUpdateMaintenanceObjectActive(name); err != nil || !active {
		t.Fatalf("maintenance active = %v error = %v, want active", active, err)
	}
	if _, err := acquireWindowsUpdateMaintenanceObject(name); err == nil {
		t.Fatal("second maintenance acquisition unexpectedly succeeded")
	}
	lease.Release()
	if active, err := windowsUpdateMaintenanceObjectActive(name); err != nil || active {
		t.Fatalf("maintenance active after release = %v error = %v, want inactive", active, err)
	}
}

func TestPrepareWindowsUpdateHandoffWaitsForSignal(t *testing.T) {
	handoff, err := prepareWindowsUpdateHandoff()
	if err != nil {
		t.Fatalf("prepare update handoff: %v", err)
	}
	t.Cleanup(handoff.Close)
	namePtr, err := windows.UTF16PtrFromString(handoff.Name)
	if err != nil {
		t.Fatalf("build handoff name: %v", err)
	}
	handle, err := windows.OpenEvent(windows.EVENT_MODIFY_STATE, false, namePtr)
	if err != nil {
		t.Fatalf("open update handoff event: %v", err)
	}
	if err := windows.SetEvent(handle); err != nil {
		windows.CloseHandle(handle)
		t.Fatalf("signal update handoff event: %v", err)
	}
	windows.CloseHandle(handle)
	if err := handoff.Wait(); err != nil {
		t.Fatalf("wait for update handoff: %v", err)
	}
}
