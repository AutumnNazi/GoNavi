package runharness

import (
	"context"
	"strings"
	"testing"
)

func TestCreateRunNamesSessionFromFirstUserLine(t *testing.T) {
	ledger := testLedger(t)
	ctx := context.Background()
	content := "orders · table missing\nSELECT 1"
	if _, err := ledger.CreateRun(ctx, CreateRunRequest{
		SessionID:      "titled-session",
		Policy:         DefaultRunPolicy(),
		InitialMessage: &Message{Role: "user", Content: content},
	}); err != nil {
		t.Fatal(err)
	}
	session, err := ledger.GetSession(ctx, "titled-session", false)
	if err != nil {
		t.Fatal(err)
	}
	if session.Title != "orders · table missing" {
		t.Fatalf("title = %q", session.Title)
	}
}

func TestEmptySessionTitleFallsBackToFirstUserMessage(t *testing.T) {
	ledger := testLedger(t)
	ctx := context.Background()
	if _, err := ledger.CreateSession(ctx, CreateSessionRequest{SessionID: "legacy-session"}); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.AppendMessage(ctx, Message{
		SessionID: "legacy-session",
		Role:      "user",
		Content:   "demo · syntax error\nmore context",
	}); err != nil {
		t.Fatal(err)
	}
	session, err := ledger.GetSession(ctx, "legacy-session", false)
	if err != nil {
		t.Fatal(err)
	}
	if session.Title != "demo · syntax error" {
		t.Fatalf("title = %q", session.Title)
	}
}

func TestClipSessionTitleKeepsRuneBoundary(t *testing.T) {
	line := strings.Repeat("错", sessionTitleMaxRunes+5)
	got := clipSessionTitle(line + "\nnext")
	if got != strings.Repeat("错", sessionTitleMaxRunes) {
		t.Fatalf("clipped title length = %d", len([]rune(got)))
	}
}
