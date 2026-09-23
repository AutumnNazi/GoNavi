package syncworker

import (
	"encoding/xml"
	"strings"
	"syscall"
	"testing"
)

func TestTaskXMLPreservesPathsAndLeastPrivilege(t *testing.T) {
	for _, root := range []string{`C:\Users\用户\Backup & files`, `D:\data root\`} {
		t.Run(root, func(t *testing.T) {
			executable := `C:\Program Files\GoNavi\GoNavi.exe`
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
			if err := xml.Unmarshal([]byte(taskXML(executable, root, `domain\user`)), &task); err != nil {
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
