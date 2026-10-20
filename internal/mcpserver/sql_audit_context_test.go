package mcpserver

import (
	"context"
	"strings"
	"testing"

	"GoNavi-Wails/internal/ai"
	appcore "GoNavi-Wails/internal/app"
	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/requesttrace"
	"GoNavi-Wails/internal/sqlaudit"
)

func TestMCPExecuteSQLPassesAuditRequestID(t *testing.T) {
	for _, traced := range []bool{false, true} {
		backend := &fakeBackend{
			editableConnection: connection.SavedConnectionView{ID: "db", Config: connection.ConnectionConfig{Type: "postgres"}},
			inspection:         appcore.SQLInspection{StatementCount: 1, ReadOnly: true, Statements: []appcore.SQLStatementInspection{{Index: 1, Keyword: "select", ReadOnly: true}}},
			safetyLevel:        ai.PermissionReadOnly,
			queryResult:        connection.QueryResult{Success: true, Data: []connection.ResultSetData{}},
		}
		ctx := context.Background()
		if traced {
			ctx = requesttrace.WithContext(ctx, requesttrace.NewStore(4).Start(requesttrace.Input{Entry: "mcp", Operation: "mcp.execute_sql"}))
		}
		result, output, err := NewService(backend).ExecuteSQL(ctx, nil, executeSQLArgs{ConnectionID: "db", SQL: "SELECT 1"})
		if err != nil || result.IsError {
			t.Fatalf("execute: %+v %v", result, err)
		}
		metadata := sqlaudit.MCPContextFrom(backend.queryContext)
		if output.RequestID == "" || metadata.RequestID != output.RequestID {
			t.Fatalf("audit correlation lost: %+v %+v", metadata, output)
		}
		if traced && output.RequestID != mcpRequestID(ctx) {
			t.Fatal("replaced existing request trace ID")
		}
		protocolResult := callServerTool(t, NewServer(backend), "execute_sql", map[string]any{"connectionId": "db", "sql": "SELECT 1"})
		client := sqlaudit.MCPContextFrom(backend.queryContext).Client
		if protocolResult.IsError || !strings.HasPrefix(client, "sha256:") || strings.Contains(client, "test-client") {
			t.Fatalf("client identity not fingerprinted: %q", client)
		}
		if sqlaudit.MCPContextFrom(ctx).RequestID != "" {
			t.Fatal("modified parent context")
		}
	}
}
