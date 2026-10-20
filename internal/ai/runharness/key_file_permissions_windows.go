//go:build windows

package runharness

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

func openExistingKeyFile(path string) (*os.File, error) {
	return openKeyFile(path, windows.OPEN_EXISTING)
}

func createKeyFile(path string) (*os.File, error) {
	return openKeyFile(path, windows.CREATE_NEW)
}

func openKeyFile(path string, creationDisposition uint32) (*os.File, error) {
	pathPointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(
		pathPointer,
		windows.GENERIC_READ|windows.GENERIC_WRITE|windows.WRITE_DAC,
		windows.FILE_SHARE_READ,
		nil,
		creationDisposition,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		if creationDisposition == windows.CREATE_NEW && err == windows.ERROR_FILE_EXISTS {
			return nil, os.ErrExist
		}
		return nil, err
	}
	return os.NewFile(uintptr(handle), path), nil
}

// Windows reports POSIX mode bits as 0666 regardless of the effective ACL.
// Validate ownership through the security descriptor instead of rejecting a
// valid key solely because os.FileMode cannot represent the DACL.
//
// An elevated administrator's new files are owned by BUILTIN\Administrators,
// not the user SID. That owner is still this logon: it is the token's default
// owner, and the account remains a member of Administrators when UAC filters
// the group to deny-only.
func validateKeyFilePermissions(file *os.File, _ os.FileMode) error {
	owner, err := keyFileOwner(file)
	if err != nil {
		return err
	}
	allowed, err := keyFileOwnerAllowed(owner)
	if err != nil {
		return err
	}
	if !allowed {
		return errors.New("key file must be owned by the current user")
	}
	return nil
}

func keyFileOwner(file *os.File) (*windows.SID, error) {
	if file == nil {
		return nil, errors.New("key file handle is unavailable for ACL validation")
	}
	securityDescriptor, err := windows.GetSecurityInfo(
		windows.Handle(file.Fd()),
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION,
	)
	if err != nil {
		return nil, fmt.Errorf("read key file owner: %w", err)
	}
	if securityDescriptor == nil {
		return nil, errors.New("key file ACL has no security descriptor")
	}
	owner, _, err := securityDescriptor.Owner()
	if err != nil || owner == nil {
		return nil, errors.New("key file ACL has no verifiable owner")
	}
	return owner, nil
}

func keyFileOwnerAllowed(owner *windows.SID) (bool, error) {
	token := windows.GetCurrentProcessToken()
	currentUser, err := token.GetTokenUser()
	if err != nil || currentUser == nil || currentUser.User.Sid == nil {
		return false, errors.New("key file owner could not be compared with the current user")
	}
	if owner.Equals(currentUser.User.Sid) {
		return true, nil
	}
	if defaultOwner, ownerErr := tokenDefaultOwner(token); ownerErr == nil && defaultOwner != nil && owner.Equals(defaultOwner) {
		return true, nil
	}
	admins, err := windows.CreateWellKnownSid(windows.WinBuiltinAdministratorsSid)
	if err != nil {
		return false, fmt.Errorf("resolve Administrators SID: %w", err)
	}
	if !owner.Equals(admins) {
		return false, nil
	}
	member, err := tokenHasSID(token, admins)
	if err != nil {
		return false, fmt.Errorf("read token groups: %w", err)
	}
	return member, nil
}

func tokenHasSID(token windows.Token, sid *windows.SID) (bool, error) {
	groups, err := token.GetTokenGroups()
	if err != nil {
		return false, err
	}
	for _, group := range groups.AllGroups() {
		if group.Sid != nil && group.Sid.Equals(sid) {
			return true, nil
		}
	}
	return false, nil
}

type tokenOwner struct {
	Owner *windows.SID
}

func tokenDefaultOwner(token windows.Token) (*windows.SID, error) {
	n := uint32(64)
	for {
		buf := make([]byte, n)
		err := windows.GetTokenInformation(token, windows.TokenOwner, &buf[0], uint32(len(buf)), &n)
		if err == windows.ERROR_INSUFFICIENT_BUFFER && n > uint32(len(buf)) {
			continue
		}
		if err != nil {
			return nil, err
		}
		info := (*tokenOwner)(unsafe.Pointer(&buf[0]))
		if info.Owner == nil {
			return nil, errors.New("token has no default owner")
		}
		copied, copyErr := info.Owner.Copy()
		runtime.KeepAlive(buf)
		return copied, copyErr
	}
}

// secureKeyFileACL removes inherited grants that would make the local
// encryption key readable by another account. The logged-on user, LocalSystem,
// and built-in Administrators retain full control.
func secureKeyFileACL(file *os.File) error {
	if file == nil {
		return errors.New("key file handle is unavailable for ACL protection")
	}
	sddl, err := keyFileDACLSDDL()
	if err != nil {
		return err
	}
	securityDescriptor, err := windows.SecurityDescriptorFromString(sddl)
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

func keyFileDACLSDDL() (string, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || user == nil || user.User.Sid == nil {
		return "", errors.New("key file owner could not be compared with the current user")
	}
	sid := user.User.Sid.String()
	if sid == "" {
		return "", errors.New("key file owner could not be compared with the current user")
	}
	// OWNER RIGHTS follows whoever Windows recorded as owner. Elevated creates
	// are owned by Administrators, so that ACE does not grant the logged-on
	// user access once UAC removes the Administrators allow. Name the user.
	return "D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;" + sid + ")", nil
}
