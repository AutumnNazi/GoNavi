//go:build windows

package app

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"golang.org/x/sys/windows"
)

const windowsUpdateHandoffTimeout = 15 * time.Second

func windowsUpdateMaintenanceObjectActive(name string) (bool, error) {
	namePtr, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return false, fmt.Errorf("build update maintenance object name: %w", err)
	}
	handle, err := windows.OpenEvent(windows.SYNCHRONIZE, false, namePtr)
	if err == nil {
		windows.CloseHandle(handle)
		return true, nil
	}
	if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
		return false, nil
	}
	if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		return true, nil
	}
	return false, fmt.Errorf("open update maintenance object: %w", err)
}

func acquireWindowsUpdateMaintenanceObject(name string) (windowsUpdateMaintenanceLease, error) {
	namePtr, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return windowsUpdateMaintenanceLease{}, fmt.Errorf("build update maintenance object name: %w", err)
	}
	handle, createErr := windows.CreateEvent(nil, 1, 0, namePtr)
	if errors.Is(createErr, windows.ERROR_ALREADY_EXISTS) {
		windows.CloseHandle(handle)
		return windowsUpdateMaintenanceLease{}, errors.New("another update is already in progress for this GoNavi installation")
	}
	if createErr != nil {
		if errors.Is(createErr, windows.ERROR_ACCESS_DENIED) {
			return windowsUpdateMaintenanceLease{}, errors.New("another Windows session is updating this GoNavi installation")
		}
		return windowsUpdateMaintenanceLease{}, fmt.Errorf("create update maintenance object: %w", createErr)
	}

	var releaseOnce sync.Once
	release := func() {
		releaseOnce.Do(func() {
			windows.CloseHandle(handle)
		})
	}
	return windowsUpdateMaintenanceLease{Name: name, Release: release}, nil
}

func prepareWindowsUpdateHandoff() (windowsUpdateHandoff, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return windowsUpdateHandoff{}, fmt.Errorf("create update handoff name: %w", err)
	}
	name := `Local\GoNavi-Update-Handoff-` + hex.EncodeToString(random)
	namePtr, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return windowsUpdateHandoff{}, fmt.Errorf("build update handoff name: %w", err)
	}
	handle, err := windows.CreateEvent(nil, 1, 0, namePtr)
	if err != nil {
		if handle != 0 {
			windows.CloseHandle(handle)
		}
		return windowsUpdateHandoff{}, fmt.Errorf("create update handoff event: %w", err)
	}

	var closeOnce sync.Once
	closeHandoff := func() {
		closeOnce.Do(func() {
			windows.CloseHandle(handle)
		})
	}
	wait := func() error {
		event, err := windows.WaitForSingleObject(handle, uint32(windowsUpdateHandoffTimeout.Milliseconds()))
		if err != nil {
			return fmt.Errorf("wait for Windows updater handoff: %w", err)
		}
		if event != windows.WAIT_OBJECT_0 {
			return errors.New("Windows updater did not accept maintenance ownership in time")
		}
		return nil
	}
	return windowsUpdateHandoff{Name: name, Wait: wait, Close: closeHandoff}, nil
}
