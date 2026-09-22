package runharness

import (
	"context"
	"testing"
)

func TestListSessionsHidesQueryEditorGenerations(t *testing.T) {
	ledger := testLedger(t)
	ctx := context.Background()
	allowTools := false

	if _, err := ledger.CreateRun(ctx, CreateRunRequest{
		SessionID:      "chat-session",
		Policy:         DefaultRunPolicy(),
		InitialMessage: &Message{Role: "user", Content: "帮我看一下订单表"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.CreateSession(ctx, CreateSessionRequest{SessionID: "empty-session", Title: "新对话"}); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.CreateRun(ctx, CreateRunRequest{
		SessionID:  "editor-session",
		Policy:     DefaultRunPolicy(),
		TaskKind:   AgentTaskKindQueryEditorGeneration,
		AllowTools: &allowTools,
		InitialMessage: &Message{
			Role:    "user",
			Content: "This is a one-shot GoNavi Query Editor generation request.\nYou are GoNavi SQL inline completion.",
		},
	}); err != nil {
		t.Fatal(err)
	}

	list, err := ledger.ListSessions(ctx, SessionListRequest{Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, session := range list.Sessions {
		got[session.ID] = true
	}
	if list.Total != 2 || len(list.Sessions) != 2 || !got["chat-session"] || !got["empty-session"] || got["editor-session"] {
		t.Fatalf("visible sessions = %#v total=%d", got, list.Total)
	}

	hidden, err := ledger.GetSession(ctx, "editor-session", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(hidden.Messages) != 1 {
		t.Fatalf("hidden editor session messages = %d, want 1", len(hidden.Messages))
	}
}
