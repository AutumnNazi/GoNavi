package codex

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sampleRollout = `{"timestamp":"t0","type":"session_meta","payload":{"session_id":"th-1","cwd":"C:/work","model_provider":"openai"}}
{"timestamp":"t1","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}
{"timestamp":"t2","type":"response_item","payload":{"type":"reasoning","summary":[],"encrypted_content":"ciphertext"}}
{"timestamp":"t3","type":"response_item","payload":{"type":"custom_tool_call","name":"shell","call_id":"c1","input":"{\"cmd\":\"ls\"}"}}
{"timestamp":"t4","type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"c1","output":"ok"}}
{"timestamp":"t5","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done"}]}}
{"timestamp":"t6","type":"response_item","payload":{"type":"unknown_shape","weird":true}}
{"timestamp":"t7","type":"event_msg","payload":{"type":"token_count","info":{}}
`

func TestReadHistoryPageClassifiesEntries(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rollout.jsonl")
	if err := os.WriteFile(path, []byte(sampleRollout), 0o600); err != nil {
		t.Fatalf("write rollout: %v", err)
	}
	page, err := ReadHistoryPage(context.Background(), path, 0, 100)
	if err != nil {
		t.Fatalf("read history: %v", err)
	}
	if len(page.Entries) != 8 || page.HasMore {
		t.Fatalf("page = %d entries hasMore=%v", len(page.Entries), page.HasMore)
	}
	if page.Entries[0].Kind != HistoryKindSystem {
		t.Fatalf("first entry kind = %s, want system", page.Entries[0].Kind)
	}
	if page.Entries[1].Kind != HistoryKindMessage || page.Entries[1].Role != "user" || page.Entries[1].Text != "hello" {
		t.Fatalf("user message wrong: %+v", page.Entries[1])
	}
	if !page.Entries[2].Opaque || page.Entries[2].Kind != HistoryKindReasoning {
		t.Fatalf("encrypted reasoning must stay opaque: %+v", page.Entries[2])
	}
	if strings.Contains(page.Entries[2].Text, "ciphertext") {
		t.Fatalf("ciphertext must not leak into readable text")
	}
	if page.Entries[3].Kind != HistoryKindToolCall || page.Entries[3].Name != "shell" || page.Entries[3].CallID != "c1" {
		t.Fatalf("tool call wrong: %+v", page.Entries[3])
	}
	if page.Entries[4].Kind != HistoryKindToolOut || page.Entries[4].Text != "ok" {
		t.Fatalf("tool output wrong: %+v", page.Entries[4])
	}
	if page.Entries[6].Kind != HistoryKindOpaque || !page.Entries[6].Opaque {
		t.Fatalf("unknown payload must be opaque: %+v", page.Entries[6])
	}
}

func TestReadHistoryPagePagination(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rollout.jsonl")
	if err := os.WriteFile(path, []byte(sampleRollout), 0o600); err != nil {
		t.Fatalf("write rollout: %v", err)
	}
	first, err := ReadHistoryPage(context.Background(), path, 0, 3)
	if err != nil || len(first.Entries) != 3 || !first.HasMore || first.NextOffset != 3 {
		t.Fatalf("first page wrong: %+v err=%v", first, err)
	}
	second, err := ReadHistoryPage(context.Background(), path, 3, 100)
	if err != nil || len(second.Entries) != 5 || second.HasMore {
		t.Fatalf("second page wrong: %d entries hasMore=%v err=%v", len(second.Entries), second.HasMore, err)
	}
}
