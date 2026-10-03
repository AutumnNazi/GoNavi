package syncworker

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// plistPath 是 plutil 绝对路径：本进程可能从 GUI 之外启动，PATH 未必含 /usr/bin。
const plistPath = "/usr/bin/plutil"

// darwinAgent 是 plist 经 plutil 转换后的投影，只声明测试关心的字段。
// 用系统的 plist 解析器而不是 encoding/xml，既能覆盖 plist 的
// <dict><key> 结构，也顺带证明生成的内容真的能被 macOS 接受。
type darwinAgent struct {
	Label            string
	ProgramArguments []string
	RunAtLoad        *bool
	KeepAlive        *struct {
		SuccessfulExit *bool
	}
	ThrottleInterval *int
}

func parseDarwinAgent(t *testing.T, content string) darwinAgent {
	t.Helper()
	path := filepath.Join(t.TempDir(), "agent.plist")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command(plistPath, "-lint", path).CombinedOutput(); err != nil {
		t.Fatalf("plutil rejected the generated plist: %v: %s", err, output)
	}
	output, err := exec.Command(plistPath, "-convert", "json", "-o", "-", path).Output()
	if err != nil {
		t.Fatalf("convert generated plist to JSON: %v", err)
	}
	var agent darwinAgent
	if err := json.Unmarshal(output, &agent); err != nil {
		t.Fatal(err)
	}
	return agent
}

func TestDarwinAgentPlistPreservesArguments(t *testing.T) {
	for _, root := range []string{"/Users/用户/Backup & files", "/Volumes/data root/", "/tmp/<root>&"} {
		t.Run(root, func(t *testing.T) {
			executable := "/Applications/GoNavi.app/Contents/MacOS/GoNavi"
			agent := parseDarwinAgent(t, darwinAgentPlist("GoNaviSync-abc", executable, root))
			want := []string{executable, "sync-worker", "--data-root", root}
			if len(agent.ProgramArguments) != len(want) {
				t.Fatalf("unexpected arguments: %#v", agent.ProgramArguments)
			}
			for index, value := range want {
				if agent.ProgramArguments[index] != value {
					t.Fatalf("argument %d = %q, want %q", index, agent.ProgramArguments[index], value)
				}
			}
			if agent.Label != "GoNaviSync-abc" {
				t.Fatalf("unexpected label: %q", agent.Label)
			}
			if agent.RunAtLoad == nil || !*agent.RunAtLoad {
				t.Fatal("RunAtLoad must be true so a fresh login starts the worker")
			}
		})
	}
}

// KeepAlive 必须限定 SuccessfulExit=false：无条件重启会让 `/stop` 停止的 worker
// 被 launchd 立刻拉起，维护停机与数据目录迁移将无法完成。
func TestDarwinAgentPlistRestartsOnlyAfterAbnormalExit(t *testing.T) {
	agent := parseDarwinAgent(t, darwinAgentPlist("GoNaviSync-abc", "/Applications/GoNavi", "/tmp/root"))
	if agent.KeepAlive == nil || agent.KeepAlive.SuccessfulExit == nil {
		t.Fatal("KeepAlive.SuccessfulExit is required; an unconditional restart would resurrect a drained worker")
	}
	if *agent.KeepAlive.SuccessfulExit {
		t.Fatal("KeepAlive.SuccessfulExit must be false so /stop is not undone by launchd")
	}
	if agent.ThrottleInterval == nil || *agent.ThrottleInterval <= 0 {
		t.Fatalf("ThrottleInterval must bound restart storms, got %v", agent.ThrottleInterval)
	}
}

// AppTranslocation 下的可执行路径每次启动都可能变化，注册进 LaunchAgent 会让
// 下次登录静默失败，因此必须在写 plist 之前拦下。
func TestIsAppTranslocated(t *testing.T) {
	translocated := "/private/var/folders/qx/abc/T/AppTranslocation/9F3E1B22-D1A4-4E6B-9F76-2E1A6A7B8C90/d/GoNavi.app/Contents/MacOS/GoNavi"
	if !isAppTranslocated(translocated) {
		t.Fatal("translocated bundle path was not detected")
	}
	for _, executable := range []string{
		"/Applications/GoNavi.app/Contents/MacOS/GoNavi",
		"/Users/me/Downloads/GoNavi.app/Contents/MacOS/GoNavi",
	} {
		if isAppTranslocated(executable) {
			t.Fatalf("stable path %q was misreported as translocated", executable)
		}
	}
}

// 转义后的 plist 必须不含裸的 XML 元字符，否则解析器会拒绝整份文件。
func TestDarwinAgentPlistEscapesUserPaths(t *testing.T) {
	content := darwinAgentPlist("GoNaviSync-abc", "/Applications/A & B/GoNavi", "/tmp/<root>&")
	if agent := parseDarwinAgent(t, content); agent.ProgramArguments[0] != "/Applications/A & B/GoNavi" {
		t.Fatalf("escaped path did not round-trip: %#v", agent.ProgramArguments)
	}
}
