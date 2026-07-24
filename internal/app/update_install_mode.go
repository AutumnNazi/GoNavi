package app

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const windowsMSIInstallMarker = ".gonavi-msi-install"

type updateInstallMode string

const (
	updateInstallModeUnknown  updateInstallMode = "unknown"
	updateInstallModePortable updateInstallMode = "portable"
	updateInstallModeMSI      updateInstallMode = "msi"
)

type updatePackageType string

const (
	updatePackageTypePortable updatePackageType = "portable"
	updatePackageTypeMSI      updatePackageType = "msi"
	updatePackageTypeDMG      updatePackageType = "dmg"
	updatePackageTypeArchive  updatePackageType = "archive"
)

func resolveCurrentUpdateInstallMode() updateInstallMode {
	return resolveUpdateInstallModeForExecutable(runtime.GOOS, updateResolveInstallTarget())
}

// IsWindowsMSIInstallExecutable reports whether executablePath belongs to a
// GoNavi MSI installation. The marker is packaged next to the stable MSI exe.
func IsWindowsMSIInstallExecutable(goos string, executablePath string) bool {
	return resolveUpdateInstallModeForExecutable(goos, executablePath) == updateInstallModeMSI
}

func resolveUpdateInstallModeForExecutable(goos string, executablePath string) updateInstallMode {
	if !strings.EqualFold(strings.TrimSpace(goos), "windows") {
		return updateInstallModeUnknown
	}
	executablePath = strings.TrimSpace(executablePath)
	if executablePath == "" {
		return updateInstallModeUnknown
	}
	markerPath := filepath.Join(filepath.Dir(executablePath), windowsMSIInstallMarker)
	info, err := os.Stat(markerPath)
	if err == nil {
		if info.IsDir() {
			return updateInstallModeUnknown
		}
		return updateInstallModeMSI
	}
	if errors.Is(err, os.ErrNotExist) {
		return updateInstallModePortable
	}
	return updateInstallModeUnknown
}

func resolveUpdatePackageType(goos string, installMode updateInstallMode) updatePackageType {
	switch strings.ToLower(strings.TrimSpace(goos)) {
	case "windows":
		if installMode == updateInstallModeMSI {
			return updatePackageTypeMSI
		}
		if installMode == updateInstallModePortable {
			return updatePackageTypePortable
		}
	case "darwin":
		return updatePackageTypeDMG
	case "linux":
		return updatePackageTypeArchive
	}
	return ""
}

func isUpdatePackageCompatibleWithInstallMode(goos string, installMode updateInstallMode, packageType updatePackageType, assetPath string) bool {
	if !strings.EqualFold(strings.TrimSpace(goos), "windows") {
		return true
	}
	extension := strings.ToLower(strings.TrimSpace(filepath.Ext(strings.TrimSpace(assetPath))))
	switch installMode {
	case updateInstallModeMSI:
		return packageType == updatePackageTypeMSI && extension == ".msi"
	case updateInstallModePortable:
		return packageType == updatePackageTypePortable && (extension == ".zip" || extension == ".exe")
	default:
		return false
	}
}

func validateUpdatePackageForCurrentInstallMode(goos string, declaredMode updateInstallMode, packageType updatePackageType, assetPath string) error {
	if !strings.EqualFold(strings.TrimSpace(goos), "windows") {
		return nil
	}
	currentMode := updateResolveInstallMode()
	if currentMode == updateInstallModeUnknown || declaredMode != currentMode ||
		!isUpdatePackageCompatibleWithInstallMode(goos, currentMode, packageType, assetPath) {
		return localizedUpdateError{
			key: "app.update.backend.error.online_update_unsupported",
			params: map[string]any{
				"platform": strings.Join([]string{
					strings.TrimSpace(goos),
					string(currentMode),
					string(declaredMode),
					string(packageType),
				}, "/"),
			},
		}
	}
	return nil
}
