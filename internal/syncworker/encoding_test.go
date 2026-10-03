package syncworker

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

const testTaskXML = `<?xml version="1.0" encoding="UTF-8"?><Task><Command>C:\Users\用户\GoNavi.exe</Command></Task>`

// 刻意不依赖 taskXML（它只存在于 GOOS=windows 的文件里）：编码契约要在
// Linux/macOS 的默认 CI 上就能守住，不能等到 Windows 机器上才发现。
func TestTaskXMLBytesUsesTaskSchedulerUnicodeEncoding(t *testing.T) {
	encoded, err := taskXMLBytes(testTaskXML)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(encoded, []byte{0xFF, 0xFE}) {
		t.Fatalf("task XML must start with a UTF-16LE BOM, got % x", encoded[:min(4, len(encoded))])
	}
	decoded, _, err := transform.Bytes(unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewDecoder(), encoded)
	if err != nil {
		t.Fatal(err)
	}
	// 去掉 BOM 后必须是真的双字节 UTF-16 序列，而不是原样写出的 UTF-8 字节。
	if bytes.Equal(encoded[2:], []byte(testTaskXML)) {
		t.Fatal("task XML was written as raw UTF-8 without re-encoding")
	}
	if !strings.Contains(string(decoded), "用户") {
		t.Fatal("non-ASCII path was not preserved")
	}
}

// 声明必须跟着字节一起改：带 BOM 却声明 UTF-8 会落在「按 BOM 判定」与
// 「按声明判定」的分歧区，正是不可诊断故障的来源。
func TestTaskXMLBytesRewritesTheEncodingDeclaration(t *testing.T) {
	encoded, err := taskXMLBytes(testTaskXML)
	if err != nil {
		t.Fatal(err)
	}
	decoded, _, err := transform.Bytes(unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewDecoder(), encoded)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(decoded), taskXMLDeclarationUTF16) {
		t.Fatalf("declaration not rewritten: %.60s", decoded)
	}
	if strings.Contains(string(decoded), `encoding="UTF-8"`) {
		t.Fatal("stale UTF-8 declaration survived alongside a UTF-16 BOM")
	}
	// 声明之外的正文必须逐字节保持原样。
	body := strings.TrimPrefix(testTaskXML, taskXMLDeclarationUTF8)
	if !strings.HasSuffix(string(decoded), body) {
		t.Fatal("task body changed during re-encoding")
	}
}

// 缺少预期声明时必须报错而不是静默产出声明与字节不符的文件。
func TestTaskXMLBytesRejectsMissingDeclaration(t *testing.T) {
	if _, err := taskXMLBytes("<Task/>"); err == nil {
		t.Fatal("expected an error for a task XML without the expected declaration")
	}
}

// 候选顺序固定，且第一个必须是 UTF-16LE + BOM：调用方用它做任务定义是否变化的
// 比较基准，顺序漂移会让 marker 反复判定为「已变化」而重复注册。
func TestTaskXMLCandidatesTryUnicodeFirstThenUTF8(t *testing.T) {
	candidates, err := taskXMLCandidates(testTaskXML)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 2 {
		t.Fatalf("expected two encoding candidates, got %d", len(candidates))
	}
	if !bytes.HasPrefix(candidates[0], []byte{0xFF, 0xFE}) {
		t.Fatal("first candidate must be the task scheduler's UTF-16LE + BOM form")
	}
	if !bytes.Equal(candidates[1], []byte(testTaskXML)) {
		t.Fatal("second candidate must be the original UTF-8 form")
	}
	if bytes.Equal(candidates[0], candidates[1]) {
		t.Fatal("candidates must differ, otherwise the fallback is a no-op")
	}
}

// 回退必须是「首个成功即停」，而不是把每份编码都注册一遍 —— 后者会在任务
// 计划程序里反复覆盖同名任务，第二次可能以「已存在」之类的理由报错。
func TestFirstAcceptedEncodingStopsAtTheFirstSuccess(t *testing.T) {
	candidates := [][]byte{[]byte("a"), []byte("b"), []byte("c")}
	var seen []string
	accepted, err := firstAcceptedEncoding(candidates, func(candidate []byte) error {
		seen = append(seen, string(candidate))
		if string(candidate) == "b" {
			return nil
		}
		return fmt.Errorf("rejected %s", candidate)
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(accepted) != "b" {
		t.Fatalf("accepted %q, want the first successful candidate", accepted)
	}
	if len(seen) != 2 {
		t.Fatalf("attempted %v, want to stop right after the first success", seen)
	}
}

// 全部被拒时，错误里要能看见每一份候选各自的原因，否则无从区分是编码问题
// 还是权限、账户之类真正的原因。
func TestFirstAcceptedEncodingReportsEveryFailure(t *testing.T) {
	candidates := [][]byte{[]byte("a"), []byte("b")}
	_, err := firstAcceptedEncoding(candidates, func(candidate []byte) error {
		return fmt.Errorf("ERROR: access is denied")
	})
	if err == nil {
		t.Fatal("expected an error when every candidate is rejected")
	}
	message := err.Error()
	if !strings.Contains(message, "candidate 1") || !strings.Contains(message, "candidate 2") {
		t.Fatalf("error must attribute each failure to its candidate: %s", message)
	}
	if strings.Count(message, "access is denied") != 2 {
		t.Fatalf("error must keep every candidate's own output: %s", message)
	}
}

// marker 存的是「上次真正注册成功的那份编码」。回退到 UTF-8 成功后，必须
// 仍被认作「定义未变化」，否则每次启动都会白白重新注册一遍。
func TestMatchesAnyCandidateAcceptsEveryFallbackForm(t *testing.T) {
	candidates, err := taskXMLCandidates(testTaskXML)
	if err != nil {
		t.Fatal(err)
	}
	for index, candidate := range candidates {
		if !matchesAnyCandidate(candidate, candidates) {
			t.Fatalf("candidate %d not recognised as its own marker", index)
		}
	}
	if matchesAnyCandidate([]byte("<Task/>"), candidates) {
		t.Fatal("an unrelated definition must not match the marker")
	}
	if matchesAnyCandidate(nil, candidates) {
		t.Fatal("an empty marker must not match")
	}
}
