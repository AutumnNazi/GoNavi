package runharness

import (
	"context"
	"strings"
	"testing"
)

func TestContextCompactsOlderToolResultsAtNinetyPercent(t *testing.T) {
	toolResult := `{"error":"` + strings.Repeat("connection reset ", 400) + `"}`
	messages := []Message{
		{ID: "old-tool", Role: "tool", ToolCallID: "call-1", Content: toolResult},
		{ID: "old-assistant", Role: "assistant", Content: strings.Repeat("先前的长回答。", 80)},
		{ID: "question", Role: "user", Content: "那你连接MySQL"},
	}
	built, err := NewDeterministicContextBuilder().Build(context.Background(), ContextBuildRequest{
		Run:                  RunSnapshot{ID: "run", SessionID: "session"},
		Messages:             messages,
		ContextWindowTokens:  4000,
		ReservedOutputTokens: 400,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !built.Compression.ContentCompacted {
		t.Fatalf("compression = %+v, want older messages shortened", built.Compression)
	}
	if built.Compression.Applied {
		t.Fatalf("shortening must not drop messages or disable tools: %+v", built.Compression)
	}
	var sawQuestion, sawShortTool bool
	for _, message := range built.Request.Messages {
		if message.ID == "question" && message.Content != "那你连接MySQL" {
			t.Fatalf("newest question was changed: %q", message.Content)
		}
		if message.ID == "question" {
			sawQuestion = true
		}
		if message.ID == "old-tool" {
			if len(message.Content) >= len(toolResult) {
				t.Fatalf("tool result was not shortened: %d", len(message.Content))
			}
			sawShortTool = true
		}
	}
	if !sawQuestion || !sawShortTool {
		t.Fatalf("projection = %#v", built.Request.Messages)
	}
	for _, message := range built.Transcript {
		if message.ID == "old-tool" && message.Content != toolResult {
			t.Fatal("ledger transcript was modified")
		}
	}
}
