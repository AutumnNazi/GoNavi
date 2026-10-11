package codex

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeRolloutLines(t *testing.T, dir, name string, lines ...string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatalf("write rollout: %v", err)
	}
	return path
}

// 尾部预览取最后一条真实输入；标题仍取第一条；注入包装被跳过。
func TestExtractLastUserPreviewPrefersLastRealInput(t *testing.T) {
	dir := t.TempDir()
	path := writeRolloutLines(t, dir, "rollout.jsonl",
		`{"type":"session_meta","payload":{"session_id":"th-1","cwd":"C:/work"}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"first question"}]}}`,
		`{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"answer"}]}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<INSTRUCTIONS>ignored wrapper</INSTRUCTIONS>"}]}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"second\nquestion"}]}}`,
		`{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"final answer"}]}}`,
	)
	if got := extractLastUserPreview(path); got != "second question" {
		t.Fatalf("preview = %q, want %q", got, "second question")
	}
	if title := extractSessionTitle(path); !strings.HasPrefix(title, "first question") {
		t.Fatalf("title = %q, want first question prefix", title)
	}
}

// 推荐插件与浏览器上下文包装同为注入内容，标题与预览都必须跳过。
func TestTitleAndPreviewSkipPluginAndBrowserWrappers(t *testing.T) {
	dir := t.TempDir()
	path := writeRolloutLines(t, dir, "rollout.jsonl",
		`{"type":"session_meta","payload":{"session_id":"th-wrap","cwd":"C:/work"}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<recommended_plugins> Here is a list of plugins"}]}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<in-app-browser-context source=\"ambient-ui-state\"> auto block"}]}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"帮我看看这个构建为什么挂了"}]}}`,
	)
	if title := extractSessionTitle(path); title != "帮我看看这个构建为什么挂了" {
		t.Fatalf("title = %q, want real input", title)
	}
	if got := extractLastUserPreview(path); got != "帮我看看这个构建为什么挂了" {
		t.Fatalf("preview = %q, want real input", got)
	}
}

// 扫描窗口从超长行中间切入：残行被跳过，其后真实输入仍被提取。
func TestExtractLastUserPreviewSkipsPartialWindowLine(t *testing.T) {
	dir := t.TempDir()
	// 填充行超过 256KB，使窗口起点确定落在该行内部。
	padding := strings.Repeat("x", lastUserPreviewMinSpan+4096)
	path := writeRolloutLines(t, dir, "rollout-big.jsonl",
		`{"type":"session_meta","payload":{"session_id":"th-pad","cwd":"C:/work"}}`,
		`{"type":"response_item","payload":{"type":"reasoning","summary":[],"encrypted_content":"`+padding+`"}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"tail question"}]}}`,
	)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat rollout: %v", err)
	}
	if windowStart := info.Size() - lastUserPreviewMinSpan; windowStart <= 0 {
		t.Fatalf("fixture too small for window test: size=%d", info.Size())
	}
	if got := extractLastUserPreview(path); got != "tail question" {
		t.Fatalf("preview = %q, want %q", got, "tail question")
	}
}

// 最后一条用户输入被超过一个窗口的大段助手输出盖住时，扫描向前回退
// 仍能找到（回退上限 2MB）。
func TestExtractLastUserPreviewBacktracksPastAssistantTail(t *testing.T) {
	dir := t.TempDir()
	padding := strings.Repeat("x", 400<<10)
	path := writeRolloutLines(t, dir, "rollout-deep.jsonl",
		`{"type":"session_meta","payload":{"session_id":"th-deep","cwd":"C:/work"}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"recent question"}]}}`,
		`{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"`+padding+`"}]}}`,
	)
	if got := extractLastUserPreview(path); got != "recent question" {
		t.Fatalf("preview = %q, want %q", got, "recent question")
	}
}

// 尾部窗口内没有用户输入时留空，不用文件名或其他内容猜测。
func TestExtractLastUserPreviewEmptyWithoutUserMessage(t *testing.T) {
	dir := t.TempDir()
	path := writeRolloutLines(t, dir, "rollout.jsonl",
		`{"type":"session_meta","payload":{"session_id":"th-2"}}`,
		`{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"only assistant"}]}}`,
		`{"type":"response_item","payload":{"type":"event_msg","payload":{}}}`,
	)
	if got := extractLastUserPreview(path); got != "" {
		t.Fatalf("preview = %q, want empty", got)
	}
}

// readSessionHeader 一次性带出标题与尾部预览。
func TestReadSessionHeaderCarriesTitleAndPreview(t *testing.T) {
	dir := t.TempDir()
	path := writeRolloutLines(t, dir, "rollout.jsonl",
		`{"type":"session_meta","payload":{"session_id":"th-3","cwd":"C:/work","model_provider":"openai"}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"opening input"}]}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"closing input"}]}}`,
	)
	meta, err := readSessionHeader(path, false)
	if err != nil {
		t.Fatalf("read header: %v", err)
	}
	if !strings.HasPrefix(meta.Title, "opening input") {
		t.Fatalf("title = %q, want opening input prefix", meta.Title)
	}
	if meta.LastUserPreview != "closing input" {
		t.Fatalf("preview = %q, want %q", meta.LastUserPreview, "closing input")
	}
}
