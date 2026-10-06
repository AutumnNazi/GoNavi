package app

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestZipGenerationDirRoundTrip 校验导出压缩包可读、条目路径前缀固定
// 且内容与源一致（V-24 的导出面）。
func TestZipGenerationDirRoundTrip(t *testing.T) {
	sourceDir := t.TempDir()
	writeExportSource(t, filepath.Join(sourceDir, "manifest.json"), "{\"formatVersion\":1}")
	writeExportSource(t, filepath.Join(sourceDir, "raw", "rollout.jsonl"), "{\"rev\":1}\n")
	writeExportSource(t, filepath.Join(sourceDir, "attachments", "a.bin"), "attachment")

	target := filepath.Join(t.TempDir(), "export.zip")
	if err := zipGenerationDir(sourceDir, target); err != nil {
		t.Fatalf("zip generation dir: %v", err)
	}
	reader, err := zip.OpenReader(target)
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	defer reader.Close()
	contents := map[string]string{}
	for _, entry := range reader.File {
		if !strings.HasPrefix(entry.Name, "session-assets/") {
			t.Fatalf("entry %s escapes the fixed prefix", entry.Name)
		}
		opened, err := entry.Open()
		if err != nil {
			t.Fatalf("open entry: %v", err)
		}
		buffer := new(strings.Builder)
		for {
			chunk := make([]byte, 256)
			n, err := opened.Read(chunk)
			buffer.Write(chunk[:n])
			if err != nil {
				break
			}
		}
		_ = opened.Close()
		contents[entry.Name] = buffer.String()
	}
	if contents["session-assets/raw/rollout.jsonl"] != "{\"rev\":1}\n" {
		t.Fatalf("rollout entry content mismatch: %q", contents["session-assets/raw/rollout.jsonl"])
	}
	if contents["session-assets/attachments/a.bin"] != "attachment" {
		t.Fatalf("attachment entry content mismatch")
	}
	if contents["session-assets/manifest.json"] != "{\"formatVersion\":1}" {
		t.Fatalf("manifest entry content mismatch")
	}
}

// TestSessionAssetsSelectExportDirectoryRejectsNothingOnCancel 校验目录
// 选择在无 Wails 事件总线的测试环境下不 panic（取消路径返回失败结果）。
func TestSessionAssetsSelectExportDirectoryWithoutRuntime(t *testing.T) {
	a := NewApp()
	result := a.SessionAssetsSelectExportDirectory()
	if result.Success {
		t.Fatalf("without a wails runtime the dialog must fail or cancel, got success")
	}
}

func writeExportSource(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
}
