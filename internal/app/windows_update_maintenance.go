package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"path/filepath"
	"strings"
)

type windowsUpdateMaintenanceLease struct {
	Name    string
	Release func()
}

type windowsUpdateHandoff struct {
	Name  string
	Wait  func() error
	Close func()
}

func WindowsUpdateMaintenanceActive(goos string, executablePath string) (bool, error) {
	if !strings.EqualFold(strings.TrimSpace(goos), "windows") {
		return false, nil
	}
	name, err := resolveWindowsUpdateMaintenanceName(executablePath)
	if err != nil {
		return false, err
	}
	return windowsUpdateMaintenanceObjectActive(name)
}

func acquireWindowsUpdateMaintenance(executablePath string) (windowsUpdateMaintenanceLease, error) {
	name, err := resolveWindowsUpdateMaintenanceName(executablePath)
	if err != nil {
		return windowsUpdateMaintenanceLease{}, err
	}
	return acquireWindowsUpdateMaintenanceObject(name)
}

func resolveWindowsUpdateMaintenanceName(executablePath string) (string, error) {
	executablePath = strings.TrimSpace(executablePath)
	if executablePath == "" {
		return "", errors.New("update maintenance executable path is empty")
	}
	absolute, err := filepath.Abs(executablePath)
	if err != nil {
		return "", err
	}
	if evaluated, evalErr := filepath.EvalSymlinks(absolute); evalErr == nil {
		absolute = evaluated
	}
	installDir := strings.ToLower(filepath.Clean(filepath.Dir(absolute)))
	digest := sha256.Sum256([]byte(installDir))
	return `Global\GoNavi-Update-` + hex.EncodeToString(digest[:16]), nil
}
