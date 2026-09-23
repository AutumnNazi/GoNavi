package syncworker

import (
	"encoding/xml"
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
			var task struct {
				Actions struct {
					Exec struct{ Command, Arguments string }
				}
				Principals struct {
					Principal struct{ LogonType, RunLevel string }
				}
				Settings struct {
					ExecutionTimeLimit                                 string
					DisallowStartIfOnBatteries, StopIfGoingOnBatteries bool
				}
			}
			if err := xml.Unmarshal(decoded, &task); err != nil {
				t.Fatal(err)
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

func taskXMLBytesForTest(t *testing.T, executable, root, username string) []byte {
	t.Helper()
	encoded, err := taskXMLBytes(taskXML(executable, root, username))
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
