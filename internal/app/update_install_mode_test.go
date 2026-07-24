package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveUpdateInstallModeForExecutableUsesSiblingMSIMarker(t *testing.T) {
	installDir := t.TempDir()
	executablePath := filepath.Join(installDir, "GoNavi.exe")

	if got := resolveUpdateInstallModeForExecutable("windows", executablePath); got != updateInstallModePortable {
		t.Fatalf("install mode without marker = %q, want portable", got)
	}
	markerPath := filepath.Join(installDir, windowsMSIInstallMarker)
	if err := os.WriteFile(markerPath, []byte("msi\n"), 0o644); err != nil {
		t.Fatalf("WriteFile marker: %v", err)
	}
	if got := resolveUpdateInstallModeForExecutable("windows", executablePath); got != updateInstallModeMSI {
		t.Fatalf("install mode with marker = %q, want msi", got)
	}
	if got := resolveUpdateInstallModeForExecutable("linux", executablePath); got != updateInstallModeUnknown {
		t.Fatalf("non-Windows install mode = %q, want unknown", got)
	}
}

func TestResolveUpdateInstallModeForExecutableRejectsMarkerDirectory(t *testing.T) {
	installDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(installDir, windowsMSIInstallMarker), 0o755); err != nil {
		t.Fatalf("Mkdir marker: %v", err)
	}
	if got := resolveUpdateInstallModeForExecutable("windows", filepath.Join(installDir, "GoNavi.exe")); got != updateInstallModeUnknown {
		t.Fatalf("install mode with invalid marker directory = %q, want unknown", got)
	}
}

func TestExpectedAssetNameForWindowsInstallMode(t *testing.T) {
	cases := []struct {
		name        string
		arch        string
		installMode updateInstallMode
		want        string
	}{
		{name: "amd64 portable", arch: "amd64", installMode: updateInstallModePortable, want: "GoNavi-1.2.3-Windows-Amd64-Portable.exe"},
		{name: "amd64 msi", arch: "amd64", installMode: updateInstallModeMSI, want: "GoNavi-1.2.3-Windows-Amd64-Installer.msi"},
		{name: "arm64 portable", arch: "arm64", installMode: updateInstallModePortable, want: "GoNavi-1.2.3-Windows-Arm64-Portable.exe"},
		{name: "arm64 msi", arch: "arm64", installMode: updateInstallModeMSI, want: "GoNavi-1.2.3-Windows-Arm64-Installer.msi"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := expectedAssetNameForExecutableAndInstallMode("windows", tc.arch, "v1.2.3", "", tc.installMode)
			if err != nil {
				t.Fatalf("expectedAssetNameForExecutableAndInstallMode: %v", err)
			}
			if got != tc.want {
				t.Fatalf("asset name = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestResolveUpdateWorkspaceDirForPlatformSeparatesMSIFromInstallDirectory(t *testing.T) {
	installTarget := filepath.Join("C:\\Program Files", "GoNavi", "GoNavi.exe")
	userCacheDir := filepath.Join("C:\\Users", "tester", "AppData", "Local")

	msiDir := resolveUpdateWorkspaceDirForPlatform("windows", "1.2.3", updateInstallModeMSI, installTarget, userCacheDir)
	wantMSIDir := filepath.Join(userCacheDir, "GoNavi", "updates")
	if msiDir != wantMSIDir {
		t.Fatalf("MSI workspace = %q, want %q", msiDir, wantMSIDir)
	}
	portableDir := resolveUpdateWorkspaceDirForPlatform("windows", "1.2.3", updateInstallModePortable, installTarget, userCacheDir)
	if portableDir != filepath.Dir(installTarget) {
		t.Fatalf("portable workspace = %q, want install directory %q", portableDir, filepath.Dir(installTarget))
	}
}

func TestValidateUpdatePackageForCurrentInstallModeRejectsModeAndSuffixMismatch(t *testing.T) {
	originalResolveMode := updateResolveInstallMode
	t.Cleanup(func() { updateResolveInstallMode = originalResolveMode })
	updateResolveInstallMode = func() updateInstallMode { return updateInstallModeMSI }

	if err := validateUpdatePackageForCurrentInstallMode("windows", updateInstallModeMSI, updatePackageTypeMSI, `C:\\tmp\\GoNavi-Installer.msi`); err != nil {
		t.Fatalf("valid MSI package rejected: %v", err)
	}
	if err := validateUpdatePackageForCurrentInstallMode("windows", updateInstallModePortable, updatePackageTypePortable, `C:\\tmp\\GoNavi-Portable.exe`); err == nil {
		t.Fatal("expected changed install mode to be rejected")
	}
	if err := validateUpdatePackageForCurrentInstallMode("windows", updateInstallModeMSI, updatePackageTypeMSI, `C:\\tmp\\GoNavi-Installer.exe`); err == nil {
		t.Fatal("expected invalid MSI suffix to be rejected")
	}
}
