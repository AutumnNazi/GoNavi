//go:build windows

package runharness

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestKeyFileProviderAcceptsExistingWindowsKeyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.key")
	want := testKey(t, 43)
	if err := os.WriteFile(path, want, 0o666); err != nil {
		t.Fatal(err)
	}

	provider, err := NewKeyFileProvider(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := provider.LoadOrCreate()
	if err != nil {
		t.Fatalf("existing Windows key file must open despite POSIX mode 0666: %v", err)
	}
	if !ConstantTimeEqual(got, want) {
		t.Fatal("key file contents changed")
	}

	securityDescriptor, err := windows.GetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		t.Fatalf("read secured key ACL: %v", err)
	}
	control, _, err := securityDescriptor.Control()
	if err != nil {
		t.Fatalf("read key ACL control: %v", err)
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		t.Fatal("key ACL must disable inherited permissions")
	}
	dacl, _, err := securityDescriptor.DACL()
	if err != nil || dacl == nil {
		t.Fatalf("read key DACL: %v", err)
	}
	if dacl.AceCount != 3 {
		t.Fatalf("key DACL ACE count = %d, want user/SYSTEM/Administrators", dacl.AceCount)
	}
}

func TestKeyFileProviderAcceptsAdministratorsOwnedKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.key")
	want := testKey(t, 44)
	if err := os.WriteFile(path, want, 0o600); err != nil {
		t.Fatal(err)
	}
	admins, err := windows.CreateWellKnownSid(windows.WinBuiltinAdministratorsSid)
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION,
		admins,
		nil,
		nil,
		nil,
	); err != nil {
		t.Skipf("cannot assign Administrators as owner: %v", err)
	}

	provider, err := NewKeyFileProvider(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := provider.LoadOrCreate()
	if err != nil {
		t.Fatalf("Administrators-owned key must open for an administrator: %v", err)
	}
	if !ConstantTimeEqual(got, want) {
		t.Fatal("key file contents changed")
	}
}
