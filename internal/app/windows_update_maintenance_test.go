package app

import (
	"path/filepath"
	"testing"
)

func TestResolveWindowsUpdateMaintenanceNameUsesInstallDirectoryIdentity(t *testing.T) {
	installDir := t.TempDir()
	first, err := resolveWindowsUpdateMaintenanceName(filepath.Join(installDir, "GoNavi.exe"))
	if err != nil {
		t.Fatalf("resolve first maintenance name: %v", err)
	}
	second, err := resolveWindowsUpdateMaintenanceName(filepath.Join(installDir, "GoNavi-new.exe"))
	if err != nil {
		t.Fatalf("resolve second maintenance name: %v", err)
	}
	if first != second {
		t.Fatalf("same install directory produced different names: %q != %q", first, second)
	}
	other, err := resolveWindowsUpdateMaintenanceName(filepath.Join(t.TempDir(), "GoNavi.exe"))
	if err != nil {
		t.Fatalf("resolve other maintenance name: %v", err)
	}
	if first == other {
		t.Fatalf("different install directories produced the same name: %q", first)
	}
	if len(first) <= len(`Global\GoNavi-Update-`) || first[:len(`Global\GoNavi-Update-`)] != `Global\GoNavi-Update-` {
		t.Fatalf("maintenance name = %q, want Global namespace", first)
	}
}
