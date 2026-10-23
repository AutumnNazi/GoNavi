package main

import (
	"strings"
	"testing"
)

func TestSSEBudgets(t *testing.T) {
	for _, test := range []struct{ name, body string }{
		{"line", ":" + strings.Repeat("x", maxLineBytes) + "\n\n" + stopFrame + doneFrame},
		{"event", strings.Repeat(": "+strings.Repeat("x", 1024)+"\n", 129) + "\n" + stopFrame + doneFrame},
		{"body", strings.Repeat(":"+strings.Repeat("x", 1022)+"\n\n", maxBodyBytes/1025+1) + stopFrame + doneFrame},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, _, err := collectSSE(t, test.body)
			assertFailure(t, err, "limit_exceeded")
		})
	}
}

func TestToolBoundaries(t *testing.T) {
	toolFinish := strings.ReplaceAll(stopFrame, "stop", "tool_calls")
	for _, test := range []struct{ name, body, code string }{
		{"index", toolFrame(t, 64, "call", "lookup", `{}`), "limit_exceeded"},
		{"ID", toolFrame(t, 0, strings.Repeat("a", 129), "lookup", `{}`), "limit_exceeded"},
		{"name", toolFrame(t, 0, "call", strings.Repeat("a", 129), `{}`), "limit_exceeded"},
		{"arguments", toolFrame(t, 0, "call", "lookup", strings.Repeat("a", maxArgumentBytes+1)), "limit_exceeded"},
		{"incomplete object", toolFrame(t, 0, "call", "lookup", `{"x":`), "generation_failed"},
		{"array arguments", toolFrame(t, 0, "call", "lookup", `[]`), "generation_failed"},
		{"duplicate argument key", toolFrame(t, 0, "call", "lookup", `{"x":1,"x":2}`), "generation_failed"},
		{"duplicate call ID", toolFrame(t, 0, "same", "lookup", `{}`) + toolFrame(t, 1, "same", "lookup", `{}`), "generation_failed"},
		{"empty calls", "", "generation_failed"},
		{"terminal JSON bytes", toolFrame(t, 0, "a", "lookup", `{"x":"`+strings.Repeat(`\"`, 11000)+`"}`) + toolFrame(t, 1, "b", "lookup", `{"x":"`+strings.Repeat(`\"`, 11000)+`"}`), "limit_exceeded"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, _, err := collectSSE(t, test.body+toolFinish+doneFrame)
			assertFailure(t, err, test.code)
		})
	}
}

func TestUsageRequiresSafeCompleteCounts(t *testing.T) {
	for _, usage := range []string{
		`{}`, `{"prompt_tokens":1,"completion_tokens":2}`,
		`{"prompt_tokens":null,"completion_tokens":2,"total_tokens":3}`,
		`{"prompt_tokens":-1,"completion_tokens":2,"total_tokens":3}`,
		`{"prompt_tokens":1.5,"completion_tokens":2,"total_tokens":3}`,
		`{"prompt_tokens":"1","completion_tokens":2,"total_tokens":3}`,
		`{"prompt_tokens":9007199254740992,"completion_tokens":2,"total_tokens":3}`,
		`{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3,"prompt_tokens_details":{"cached_tokens":-1}}`,
		`{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3,"prompt_tokens_details":{"cached_tokens":null}}`,
	} {
		t.Run(usage, func(t *testing.T) {
			_, _, err := collectSSE(t, stopFrame+"data: {\"choices\":[],\"usage\":"+usage+"}\n\n"+doneFrame)
			assertFailure(t, err, "generation_failed")
		})
	}
	completion, _, err := collectSSE(t, stopFrame+"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":9007199254740991,\"completion_tokens\":0,\"total_tokens\":9007199254740991}}\n\n"+doneFrame)
	if err != nil || completion.Usage == nil || completion.Usage.CachedTokens != nil || completion.Usage.PromptTokens != 9007199254740991 {
		t.Fatalf("safe integral usage rejected: %+v %v", completion, err)
	}
}
