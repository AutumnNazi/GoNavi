package syncworker

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const (
	// launchctlPath 用绝对路径：本进程可能从 GUI 之外启动（自启动、测试），
	// PATH 未必包含 /bin，而这里失败会退化成「只在下次登录生效」。
	launchctlPath = "/bin/launchctl"
	// darwinThrottleSeconds 是 KeepAlive 重启的最小间隔（秒），防止重启风暴。
	darwinThrottleSeconds = "10"
	// bootout 后 bootstrap 需要等 launchd 真正卸载完，实测约 300ms 内可恢复。
	darwinBootstrapAttempts = 5
	darwinBootstrapBackoff  = 300 * time.Millisecond
)

// darwinAgentPlist 生成 LaunchAgent 定义。
//
// KeepAlive 用 SuccessfulExit=false：只在 worker 异常退出（崩溃、被杀）时重启；
// `/stop` 触发的正常退出是 exit 0，必须让它停下，否则维护停机与数据目录迁移
// 会被 launchd 立刻拉起，停不下来。
//
// 不写 StandardOutPath/StandardErrorPath：worker 自身用 internal/logger 写
// ~/.gonavi/logs，另开 launchd 日志只会重复且无人轮转。
//
// RunAtLoad 与 KeepAlive 组合后 launchd 会在加载时即拉起 worker；与 syncworker.Run
// 的进程锁配合，重复加载的第二个实例会直接退出，所以重复 bootstrap 是安全的。
func darwinAgentPlist(label, executable, root string) string {
	escape := func(value string) string {
		var output bytes.Buffer
		xml.EscapeText(&output, []byte(value))
		return output.String()
	}
	return `<?xml version="1.0" encoding="UTF-8"?>` +
		`<plist version="1.0"><dict>` +
		`<key>Label</key><string>` + escape(label) + `</string>` +
		`<key>ProgramArguments</key><array>` +
		`<string>` + escape(executable) + `</string>` +
		`<string>sync-worker</string>` +
		`<string>--data-root</string>` +
		`<string>` + escape(root) + `</string>` +
		`</array>` +
		`<key>RunAtLoad</key><true/>` +
		`<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>` +
		`<key>ThrottleInterval</key><integer>` + darwinThrottleSeconds + `</integer>` +
		`</dict></plist>`
}

// isAppTranslocated 判断可执行文件是否来自 Gatekeeper 的 App Translocation。
// 该路径（/private/var/folders/.../AppTranslocation/<随机>/）每次启动都可能变化，
// 写进 LaunchAgent 后下次登录会静默失败，因此必须在注册前拦下。
func isAppTranslocated(executable string) bool {
	return strings.Contains(executable, string(filepath.Separator)+"AppTranslocation"+string(filepath.Separator))
}

// Register 写入 LaunchAgent 并立即加载，使本次登录会话内也能生效。
func Register(ctx context.Context, root, executable string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if isAppTranslocated(executable) {
		return errors.New("sync worker runs from a Gatekeeper translocation path; move GoNavi into /Applications and reopen it before enabling schedules")
	}
	path, err := darwinAgentPath(root)
	if err != nil {
		return err
	}
	return writeDarwinAgent(ctx, path, registrationID(root), executable, root)
}

// Unregister 同时 bootout 与删除文件。只删文件时 launchd 仍保留 job 定义、
// worker 继续运行，注销语义落空，所以两步缺一不可。
func Unregister(ctx context.Context, root string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := darwinAgentPath(root)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// job 可能从未加载过，此时 bootout 返回 ESRCH，等价于已注销。
	if err := runLaunchctl(ctx, "bootout", darwinServiceTarget(registrationID(root))); err != nil && !isLaunchctlNotLoaded(err) {
		return err
	}
	return nil
}

func darwinAgentPath(root string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	directory := filepath.Join(home, "Library", "LaunchAgents")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	return filepath.Join(directory, registrationID(root)+".plist"), nil
}

func writeDarwinAgent(ctx context.Context, path, label, executable, root string) error {
	content := []byte(darwinAgentPlist(label, executable, root))
	// 内容未变且 job 已加载时直接返回，与 Windows 的 worker-task.xml 短路同义。
	// 重装必须先 bootout，而 bootout 会终止正在运行的 worker（已实测），
	// 每次保存任务都重装就会打断正在执行的备份。
	if existing, err := os.ReadFile(path); err == nil && bytes.Equal(existing, content) && darwinAgentLoaded(ctx, label) {
		return nil
	}
	if err := os.WriteFile(path, content, 0o600); err != nil {
		return err
	}
	// launchd 不会察觉 plist 被就地覆盖：重复 bootstrap 同一 Label 会立刻以
	// errno 5 失败并保留旧定义。先 bootout 清掉旧定义，再加载新内容。
	if err := runLaunchctl(ctx, "bootout", darwinServiceTarget(label)); err != nil && !isLaunchctlNotLoaded(err) {
		return fmt.Errorf("unload previous LaunchAgent (plist already written to %s): %w", path, err)
	}
	if err := loadDarwinAgent(ctx, path); err != nil {
		return fmt.Errorf("load LaunchAgent (plist already written to %s): %w", path, err)
	}
	return nil
}

// darwinAgentLoaded 探测 job 是否已被 launchd 加载（含已加载但未运行的状态）。
func darwinAgentLoaded(ctx context.Context, label string) bool {
	return exec.CommandContext(ctx, launchctlPath, "print", darwinServiceTarget(label)).Run() == nil
}

// loadDarwinAgent 带退避重试 bootstrap。bootout 是异步的：紧接着 bootstrap
// 同一 Label 会以 errno 5 失败，稍等即可成功（已实测），所以必须重试而不是
// 把一次瞬时失败当成注册失败。
func loadDarwinAgent(ctx context.Context, path string) error {
	var lastErr error
	for attempt := 0; attempt < darwinBootstrapAttempts; attempt++ {
		if attempt > 0 {
			timer := time.NewTimer(darwinBootstrapBackoff)
			select {
			case <-ctx.Done():
				timer.Stop()
				return lastErr
			case <-timer.C:
			}
		}
		if lastErr = runLaunchctl(ctx, "bootstrap", darwinGUIDomain(), path); lastErr == nil {
			return nil
		}
	}
	return lastErr
}

func darwinGUIDomain() string {
	return fmt.Sprintf("gui/%d", os.Getuid())
}

func darwinServiceTarget(label string) string {
	return darwinGUIDomain() + "/" + label
}

func runLaunchctl(ctx context.Context, args ...string) error {
	command := exec.CommandContext(ctx, launchctlPath, args...)
	// 失败原因只出现在 stderr，保留它才能区分「未加载」与「真的出错」。
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("%s %s: %w: %s", launchctlPath, strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

// isLaunchctlNotLoaded 判断 bootout 的失败是否只是「该 job 未加载」（ESRCH）。
// 这种状态等价于已注销，不是错误。按退出码判定而不是匹配 stderr 文案，
// 后者会随系统语言变化而失效。
func isLaunchctlNotLoaded(err error) bool {
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		return false
	}
	return exitErr.ExitCode() == int(syscall.ESRCH)
}
