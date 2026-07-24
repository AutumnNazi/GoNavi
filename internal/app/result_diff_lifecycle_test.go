package app

import (
	"testing"
	"time"

	"GoNavi-Wails/internal/resultdiff"
)

func TestConnectionKeepAliveTickPrunesExpiredResultDiffSessions(t *testing.T) {
	application := NewApp()
	application.resultDiffManager = resultdiff.NewManager(time.Minute)
	session := application.resultDiffManager.Create(resultdiff.StartRequest{KeyColumns: []string{"id"}})

	application.runConnectionKeepAliveTick(session.CreatedAt.Add(time.Minute + time.Nanosecond))

	if _, err := application.resultDiffManager.Get(session.ID); err == nil {
		t.Fatal("maintenance tick left expired result diff session reachable")
	}
}

func TestCloseResultDiffSessionsReleasesManagerState(t *testing.T) {
	application := NewApp()
	session := application.resultDiffManager.Create(resultdiff.StartRequest{KeyColumns: []string{"id"}})

	if closed := application.closeResultDiffSessions(); closed != 1 {
		t.Fatalf("closeResultDiffSessions closed %d sessions, want 1", closed)
	}
	if _, err := application.resultDiffManager.Get(session.ID); err == nil {
		t.Fatal("shutdown cleanup left result diff session reachable")
	}
	start := application.ResultDiffStart(ResultDiffStartRequest{
		Left:       resultdiff.DatasetSpec{Mode: resultdiff.DatasetModeRows},
		Right:      resultdiff.DatasetSpec{Mode: resultdiff.DatasetModeRows},
		KeyColumns: []string{"id"},
	})
	if start.Success {
		t.Fatal("result diff manager accepted a new session after shutdown cleanup")
	}
}
