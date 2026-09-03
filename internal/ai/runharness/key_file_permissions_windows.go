//go:build windows

package runharness

import (
	"errors"
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

// Windows reports POSIX mode bits as 0666 regardless of the effective ACL.
// Validate ownership through the security descriptor instead of rejecting a
// valid key solely because os.FileMode cannot represent the DACL.
func validateKeyFilePermissions(file *os.File, _ os.FileMode) error {
	if file == nil {
		return errors.New("key file handle is unavailable for ACL validation")
	}
	securityDescriptor, err := windows.GetSecurityInfo(
		windows.Handle(file.Fd()),
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION,
	)
	if err != nil {
		return fmt.Errorf("read key file owner: %w", err)
	}
	if securityDescriptor == nil {
		return errors.New("key file ACL has no security descriptor")
	}
	owner, _, err := securityDescriptor.Owner()
	if err != nil || owner == nil {
		return errors.New("key file ACL has no verifiable owner")
	}
	currentUser, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || currentUser == nil || currentUser.User.Sid == nil {
		return errors.New("key file owner could not be compared with the current user")
	}
	if !owner.Equals(currentUser.User.Sid) {
		return errors.New("key file must be owned by the current user")
	}
	return nil
}

// secureKeyFileACL removes inherited/group grants that would make the local
// encryption key readable by another account. The owner, LocalSystem, and
// built-in Administrators retain full control for normal Windows recovery and
// service-management scenarios.
func secureKeyFileACL(file *os.File) error {
	if file == nil {
		return errors.New("key file handle is unavailable for ACL protection")
	}
	securityDescriptor, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;OW)")
	if err != nil {
		return fmt.Errorf("build key file ACL: %w", err)
	}
	dacl, _, err := securityDescriptor.DACL()
	if err != nil || dacl == nil {
		if err != nil {
			return fmt.Errorf("read key file ACL: %w", err)
		}
		return errors.New("build key file ACL returned no DACL")
	}
	return windows.SetSecurityInfo(
		windows.Handle(file.Fd()),
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil,
		nil,
		dacl,
		nil,
	)
}
