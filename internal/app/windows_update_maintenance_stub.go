//go:build !windows

package app

import "errors"

func windowsUpdateMaintenanceObjectActive(string) (bool, error) {
	return false, nil
}

func acquireWindowsUpdateMaintenanceObject(string) (windowsUpdateMaintenanceLease, error) {
	return windowsUpdateMaintenanceLease{}, errors.New("Windows update maintenance is unavailable on this platform")
}

func prepareWindowsUpdateHandoff() (windowsUpdateHandoff, error) {
	return windowsUpdateHandoff{}, errors.New("Windows update handoff is unavailable on this platform")
}
