package provider

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestGrokCLIUpstreamStateGivesUpWhenChannelStaysUnavailable(t *testing.T) {
	var state grokCLIUpstreamState
	message := "API error (status 503 Service Unavailable): one_hub_error: 当前分组 grok分组 下对于模型 grok-4.6 无可用渠道 (request id: abc)"
	if _, giveUp := state.observe(message, true); giveUp {
		t.Fatal("a single unavailable retry must keep waiting")
	}
	if _, giveUp := state.observe(message, true); giveUp {
		t.Fatal("two unavailable retries must keep waiting")
	}
	activity, giveUp := state.observe(message, true)
	if !activity || !giveUp {
		t.Fatalf("third unavailable retry should stop, activity=%v giveUp=%v", activity, giveUp)
	}
	if state.message != "当前分组 grok分组 下对于模型 grok-4.6 无可用渠道" {
		t.Fatalf("message = %q", state.message)
	}
}

func TestGrokCLIUpstreamStateKeepsTransientRetriesAlive(t *testing.T) {
	var state grokCLIUpstreamState
	message := "API error (status 504 Gateway Timeout): Grok is temporarily unavailable"
	for i := 0; i < 5; i++ {
		activity, giveUp := state.observe(message, true)
		if !activity || giveUp {
			t.Fatalf("transient retry %d must not give up", i+1)
		}
	}
	activity, giveUp := state.observe(message, false)
	if !activity || !giveUp || state.message != message {
		t.Fatalf("terminal failure must surface, activity=%v giveUp=%v message=%q", activity, giveUp, state.message)
	}
}

func TestGrokCLIUpstreamWatchIgnoresOtherProcesses(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "unified.jsonl")
	if err := os.WriteFile(path, []byte(""), 0o600); err != nil {
		t.Fatal(err)
	}
	original := grokCLIUpstreamPollInterval
	grokCLIUpstreamPollInterval = 20 * time.Millisecond
	t.Cleanup(func() { grokCLIUpstreamPollInterval = original })

	gaveUp := make(chan struct{}, 1)
	watch := startGrokCLIUpstreamWatchAt(path, 42, nil, func() {
		select {
		case gaveUp <- struct{}{}:
		default:
		}
	})
	defer watch.close()
	<-watch.started

	line := `{"pid":7,"msg":"shell.turn.inference_failed","ctx":{"message":"API error (status 503): one_hub_error: 无可用渠道"}}` + "\n"
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(line + line + line); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()

	select {
	case <-gaveUp:
		t.Fatal("another process must not abort this run")
	case <-time.After(120 * time.Millisecond):
	}
	if watch.giveUpMessage() != "" {
		t.Fatalf("give up message = %q", watch.giveUpMessage())
	}
}

func TestGrokCLIUpstreamWatchWaitsForIsolatedLog(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logs", "unified.jsonl")
	original := grokCLIUpstreamPollInterval
	grokCLIUpstreamPollInterval = 20 * time.Millisecond
	t.Cleanup(func() { grokCLIUpstreamPollInterval = original })

	gaveUp := make(chan struct{}, 1)
	watch := startGrokCLIUpstreamWatchAt(path, 42, nil, func() {
		select {
		case gaveUp <- struct{}{}:
		default:
		}
	})
	defer watch.close()

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(""), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-watch.started:
	case <-time.After(time.Second):
		t.Fatal("watch did not notice the log file once it appeared")
	}
	line := `{"pid":42,"msg":"shell.turn.inference_retry","ctx":{"reason":"API error (status 503): one_hub_error: 当前分组 grok分组 下对于模型 grok-4.6 无可用渠道 (request id: abc)"}}` + "\n"
	if err := os.WriteFile(path, []byte(line+line+line), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gaveUp:
	case <-time.After(time.Second):
		t.Fatal("watch did not read retries written after the isolated log appeared")
	}
}

func TestGrokCLIUpstreamWatchStopsOnRepeatedUnavailable(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "unified.jsonl")
	if err := os.WriteFile(path, []byte("{\"pid\":1,\"msg\":\"other\"}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	original := grokCLIUpstreamPollInterval
	grokCLIUpstreamPollInterval = 20 * time.Millisecond
	t.Cleanup(func() { grokCLIUpstreamPollInterval = original })

	gaveUp := make(chan struct{}, 1)
	watch := startGrokCLIUpstreamWatchAt(path, 42, nil, func() {
		select {
		case gaveUp <- struct{}{}:
		default:
		}
	})
	defer watch.close()
	<-watch.started

	line := `{"pid":42,"msg":"shell.turn.inference_retry","ctx":{"reason":"API error (status 503): one_hub_error: 当前分组 grok分组 下对于模型 grok-4.6 无可用渠道 (request id: abc)"}}` + "\n"
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(line + line + line); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()

	select {
	case <-gaveUp:
	case <-time.After(time.Second):
		t.Fatal("watch did not notice repeated unavailable retries")
	}
	if watch.giveUpMessage() != "当前分组 grok分组 下对于模型 grok-4.6 无可用渠道" {
		t.Fatalf("message = %q", watch.giveUpMessage())
	}
}
