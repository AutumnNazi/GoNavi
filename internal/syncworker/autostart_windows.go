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
	"strings"
	"syscall"
)

func xmlText(value string) string {
	var output bytes.Buffer
	xml.EscapeText(&output, []byte(value))
	return output.String()
}

func taskXML(executable, root, username string) string {
	arguments := syscall.EscapeArg("sync-worker") + " --data-root " + syscall.EscapeArg(root)
	// 声明保持 UTF-8：这份字符串本身和「原样写出」的回退候选都是 UTF-8 字节；
	// UTF-16 候选由 taskXMLBytes 负责改写声明并重新编码。若这里直接写 UTF-16，
	// taskXMLBytes 找不到可替换的声明会报错，注册在到达 schtasks 之前就失败。
	return `<?xml version="1.0" encoding="UTF-8"?><Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><LogonTrigger><Enabled>true</Enabled><UserId>` + xmlText(username) + `</UserId></LogonTrigger></Triggers><Principals><Principal id="Author"><UserId>` + xmlText(username) + `</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings><Actions Context="Author"><Exec><Command>` + xmlText(executable) + `</Command><Arguments>` + xmlText(arguments) + `</Arguments></Exec></Actions></Task>`
}

func taskUserIdentifiers(account *user.User) []string {
	if account == nil {
		return nil
	}
	identifiers := make([]string, 0, 2)
	if sid := strings.TrimSpace(account.Uid); strings.HasPrefix(strings.ToUpper(sid), "S-") {
		identifiers = append(identifiers, sid)
	}
	if username := strings.TrimSpace(account.Username); username != "" && (len(identifiers) == 0 || !strings.EqualFold(username, identifiers[0])) {
		identifiers = append(identifiers, username)
	}
	if len(identifiers) == 0 {
		return nil
	}
	return identifiers
}

func taskXMLCandidatesForUser(executable, root string, account *user.User) ([][]byte, error) {
	identifiers := taskUserIdentifiers(account)
	if len(identifiers) == 0 {
		return nil, errors.New("current Windows user has no Task Scheduler identifier")
	}
	var candidates [][]byte
	for _, identifier := range identifiers {
		encodedCandidates, err := taskXMLCandidates(taskXML(executable, root, identifier))
		if err != nil {
			return nil, err
		}
		candidates = append(candidates, encodedCandidates...)
	}
	return candidates, nil
}

// runSchtasks 执行 schtasks.exe 并保留它的输出。
//
// 失败原因只出现在 schtasks 自己的输出里（`ERROR: ...`），裸 Run() 只留下
// `exit status 1`，界面提示因此完全不可诊断 —— 既分不清「权限不足」还是
// 「XML 被拒」，也无法据此修复。与 darwin 侧 runLaunchctl 同一约定。
func runSchtasks(ctx context.Context, args ...string) error {
	command := exec.CommandContext(ctx, "schtasks.exe", args...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Run(); err != nil {
		return fmt.Errorf("schtasks %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(output.String()))
	}
	return nil
}

// Register installs a per-user logon task without elevation or storing a password.
func Register(ctx context.Context, root, executable string) error {
	account, err := user.Current()
	if err != nil {
		return err
	}
	candidates, err := taskXMLCandidatesForUser(executable, root, account)
	if err != nil {
		return err
	}
	marker := filepath.Join(root, "data_sync", "worker-task.xml")
	// marker 里存的是「上一次真正注册成功的那份编码」。回退到 UTF-8 注册成功后
	// 若只跟 candidates[0] 比较，会判定为「已变化」而每次启动都重新注册一遍。
	if previous, err := os.ReadFile(marker); err == nil && matchesAnyCandidate(previous, candidates) {
		if err := runSchtasks(ctx, "/Query", "/TN", registrationID(root)); err == nil {
			return nil
		}
	}
	content, err := firstAcceptedEncoding(candidates, func(candidate []byte) error {
		return createSchtasksTask(ctx, root, candidate)
	})
	if err != nil {
		return fmt.Errorf("register sync worker logon task: %w", err)
	}
	return os.WriteFile(marker, content, 0o600)
}

// createSchtasksTask 用一份具体编码的任务定义向 schtasks 注册。
func createSchtasksTask(ctx context.Context, root string, content []byte) error {
	file, err := os.CreateTemp(filepath.Join(root, "data_sync"), "worker-task-*.xml")
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
	return runSchtasks(ctx, "/Create", "/TN", registrationID(root), "/XML", file.Name(), "/F")
}

// Unregister removes this data root's login task before a root migration.
func Unregister(ctx context.Context, root string) error {
	marker := filepath.Join(root, "data_sync", "worker-task.xml")
	if _, err := os.Stat(marker); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if err := runSchtasks(ctx, "/Delete", "/TN", registrationID(root), "/F"); err != nil {
		return fmt.Errorf("remove sync worker logon task: %w", err)
	}
	return os.Remove(marker)
}
