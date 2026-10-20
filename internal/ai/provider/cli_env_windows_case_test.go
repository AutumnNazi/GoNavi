package provider

import (
	"runtime"
	"testing"
)

// Windows 桌面进程的环境块键是 `Path=`（不是 `PATH=`），而 Windows 环境变量
// 本身不区分大小写。envValue/upsertEnv 若按大小写敏感匹配，PATH 增强会读不到
// 原值，拼出的新 PATH 只剩 prepend 目录，子进程里 chcp/reg/wmic 全部找不到。
func TestEnvHelpersMatchWindowsPathKeyCaseInsensitively(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows 环境块键大小写行为仅适用于 windows")
	}
	env := []string{
		"SystemRoot=C:\\WINDOWS",
		"Path=C:\\WINDOWS\\system32;C:\\Program Files\\nodejs",
	}

	if got := envValue(env, "PATH"); got != `C:\WINDOWS\system32;C:\Program Files\nodejs` {
		t.Fatalf("envValue 应读到 Path= 键的值: %q", got)
	}
	if got := envValue(env, "SystemRoot"); got != `C:\WINDOWS` {
		t.Fatalf("envValue 大写键读取不应回归: %q", got)
	}

	updated := upsertEnv(env, "PATH", `C:\Users\cky\.nvmd\bin;C:\WINDOWS\system32`)
	entries := 0
	for _, entry := range updated {
		if envKeyEqual(entry, "PATH") {
			entries++
		}
	}
	if entries != 1 {
		t.Fatalf("upsertEnv 应原位更新 Path= 键而不是追加同名变量，当前 %d 条: %v", entries, updated)
	}
	if got := envValue(updated, "PATH"); got != `C:\Users\cky\.nvmd\bin;C:\WINDOWS\system32` {
		t.Fatalf("upsertEnv 更新后的值异常: %q", got)
	}
}

func TestPrependPATHDirsKeepsWindowsPathValue(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows 环境块键大小写行为仅适用于 windows")
	}
	env := []string{"Path=C:\\WINDOWS\\system32;C:\\Program Files\\nodejs"}

	enriched := prependPATHDirs(env, "C:\\Users\\cky\\.nvmd\\bin")
	got := envValue(enriched, "PATH")
	want := `C:\Users\cky\.nvmd\bin;C:\WINDOWS\system32;C:\Program Files\nodejs`
	if got != want {
		t.Fatalf("PATH 增强应保留原 Path= 值:\n got=%q\nwant=%q", got, want)
	}
	// 不允许出现第二个同名（不同大小写）PATH 条目。
	count := 0
	for _, entry := range enriched {
		if envKeyEqual(entry, "PATH") {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("PATH 条目应只有一条，当前 %d 条: %v", count, enriched)
	}
}
