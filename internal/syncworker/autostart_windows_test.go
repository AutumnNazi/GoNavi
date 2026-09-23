package syncworker

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"os/user"
	"reflect"
	"strings"
	"syscall"
	"testing"

	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

func TestTaskXMLPreservesPathsAndLeastPrivilege(t *testing.T) {
	for _, root := range []string{`C:\Users\用户\Backup & files`, `D:\data root\`} {
		t.Run(root, func(t *testing.T) {
			executable := `C:\Program Files\GoNavi\GoNavi.exe`
			decoded, _, err := transform.Bytes(unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM).NewDecoder(), taskXMLBytesForTest(t, executable, root, `domain\user`))
			if err != nil {
				t.Fatal(err)
			}
			// The test decoder already converted UTF-16 bytes to UTF-8; update the
			// declaration before passing the document to encoding/xml, which does
			// not register a UTF-16 CharsetReader by default.
			decoded = []byte(strings.Replace(string(decoded), taskXMLDeclarationUTF16, taskXMLDeclarationUTF8, 1))
			var task struct {
				Triggers struct {
					LogonTrigger struct{ UserId string }
				}
				Actions struct {
					Exec struct{ Command, Arguments string }
				}
				Principals struct {
					Principal struct{ UserId, LogonType, RunLevel string }
				}
				Settings struct {
					ExecutionTimeLimit                                 string
					DisallowStartIfOnBatteries, StopIfGoingOnBatteries bool
				}
			}
			if err := xml.Unmarshal(decoded, &task); err != nil {
				t.Fatal(err)
			}
			if task.Triggers.LogonTrigger.UserId != `domain\user` || task.Principals.Principal.UserId != `domain\user` {
				t.Fatalf("task trigger and principal must target the same user: %+v", task)
			}
			if task.Actions.Exec.Command != executable || !strings.Contains(task.Actions.Exec.Arguments, syscall.EscapeArg(root)) {
				t.Fatalf("incorrect action: %+v", task.Actions.Exec)
			}
			if task.Principals.Principal.RunLevel != "LeastPrivilege" || task.Principals.Principal.LogonType != "InteractiveToken" {
				t.Fatalf("unexpected principal: %+v", task.Principals)
			}
			if task.Settings.ExecutionTimeLimit != "PT0S" || task.Settings.DisallowStartIfOnBatteries || task.Settings.StopIfGoingOnBatteries {
				t.Fatalf("worker must not stop on battery or after default timeout: %+v", task.Settings)
			}
		})
	}
}

func TestTaskUserIdentifiersTrySIDBeforeAccountName(t *testing.T) {
	for _, test := range []struct {
		name string
		user user.User
		want []string
	}{
		{name: "SID and account", user: user.User{Uid: "S-1-5-21-123-456-789-1001", Username: `DESKTOP\cky`}, want: []string{"S-1-5-21-123-456-789-1001", `DESKTOP\cky`}},
		{name: "missing SID", user: user.User{Username: `DESKTOP\cky`}, want: []string{`DESKTOP\cky`}},
		{name: "invalid SID", user: user.User{Uid: "1001", Username: `DESKTOP\cky`}, want: []string{`DESKTOP\cky`}},
		{name: "no identifier", user: user.User{}, want: nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := taskUserIdentifiers(&test.user); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("task user identifiers = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestTaskXMLCandidatesFallBackFromSIDToAccountName(t *testing.T) {
	account := &user.User{Uid: "S-1-5-21-123-456-789-1001", Username: `DESKTOP\cky`}
	candidates, err := taskXMLCandidatesForUser(`C:\GoNavi.exe`, `C:\GoNavi data`, account)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 4 {
		t.Fatalf("task XML candidates = %d, want SID/account name with two encodings each", len(candidates))
	}
	for index, identifier := range []string{account.Uid, account.Uid, account.Username, account.Username} {
		if !strings.Contains(taskXMLCandidateText(t, candidates[index]), "<UserId>"+identifier+"</UserId>") {
			t.Fatalf("candidate %d does not identify %q", index+1, identifier)
		}
	}
	attempted := 0
	accepted, err := firstAcceptedEncoding(candidates, func(candidate []byte) error {
		attempted++
		if attempted < 3 {
			return fmt.Errorf("Task Scheduler rejected candidate %d", attempted)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if attempted != 3 || !bytes.Equal(accepted, candidates[2]) {
		t.Fatalf("fallback accepted the wrong candidate after %d attempts", attempted)
	}
}

func taskXMLCandidateText(t *testing.T, candidate []byte) string {
	t.Helper()
	if !bytes.HasPrefix(candidate, []byte{0xFF, 0xFE}) {
		return string(candidate)
	}
	decoded, _, err := transform.Bytes(unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewDecoder(), candidate)
	if err != nil {
		t.Fatal(err)
	}
	return string(decoded)
}

func taskXMLBytesForTest(t *testing.T, executable, root, username string) []byte {
	t.Helper()
	encoded, err := taskXMLBytes(taskXML(executable, root, username))
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
