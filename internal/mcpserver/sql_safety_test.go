package mcpserver

import (
	"testing"

	"GoNavi-Wails/internal/ai"
	appcore "GoNavi-Wails/internal/app"
)

func TestApplyExecuteSQLSafetyTreatsToolCallAsConfirmation(t *testing.T) {
	inspection := appcore.SQLInspection{
		StatementCount: 1,
		ReadOnly:       false,
		Statements: []appcore.SQLStatementInspection{
			{Index: 1, Keyword: "delete", ReadOnly: false},
		},
	}

	mutatingAck, deny := applyExecuteSQLSafety(ai.PermissionReadWrite, inspection)
	if deny != "" {
		t.Fatalf("readwrite should allow DML, got deny %q", deny)
	}
	if !mutatingAck {
		t.Fatal("expected mutating acknowledgement from the execute_sql tool call")
	}

	_, deny = applyExecuteSQLSafety(ai.PermissionReadOnly, inspection)
	if deny == "" {
		t.Fatal("readonly should block DML")
	}
}
