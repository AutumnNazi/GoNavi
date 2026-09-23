package syncworker

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"syscall"
)

func xmlText(value string) string {
	var output bytes.Buffer
	xml.EscapeText(&output, []byte(value))
	return output.String()
}

func taskXML(executable, root, username string) string {
	arguments := syscall.EscapeArg("sync-worker") + " --data-root " + syscall.EscapeArg(root)
	return `<?xml version="1.0" encoding="UTF-8"?><Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><LogonTrigger><Enabled>true</Enabled><UserId>` + xmlText(username) + `</UserId></LogonTrigger></Triggers><Principals><Principal id="Author"><UserId>` + xmlText(username) + `</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings><Actions Context="Author"><Exec><Command>` + xmlText(executable) + `</Command><Arguments>` + xmlText(arguments) + `</Arguments></Exec></Actions></Task>`
}

// Register installs a per-user logon task without elevation or storing a password.
func Register(ctx context.Context, root, executable string) error {
	account, err := user.Current()
	if err != nil {
		return err
	}
	content := []byte(taskXML(executable, root, account.Username))
	marker := filepath.Join(root, "data_sync", "worker-task.xml")
	if previous, err := os.ReadFile(marker); err == nil && bytes.Equal(previous, content) {
		query := exec.CommandContext(ctx, "schtasks.exe", "/Query", "/TN", registrationID(root))
		query.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if err := query.Run(); err == nil {
			return nil
		}
	}
	file, err := os.CreateTemp(filepath.Dir(marker), "worker-task-*.xml")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(content); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	command := exec.CommandContext(ctx, "schtasks.exe", "/Create", "/TN", registrationID(root), "/XML", file.Name(), "/F")
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := command.Run(); err != nil {
		return fmt.Errorf("register sync worker logon task: %w", err)
	}
	return os.WriteFile(marker, content, 0o600)
}

// Unregister removes this data root's login task before a root migration.
func Unregister(ctx context.Context, root string) error {
	marker := filepath.Join(root, "data_sync", "worker-task.xml")
	if _, err := os.Stat(marker); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	command := exec.CommandContext(ctx, "schtasks.exe", "/Delete", "/TN", registrationID(root), "/F")
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := command.Run(); err != nil {
		return fmt.Errorf("remove sync worker logon task: %w", err)
	}
	return os.Remove(marker)
}
