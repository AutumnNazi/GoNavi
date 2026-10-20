package app

import (
	"context"
	"errors"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/sqlaudit"
)

func TestMCPAuditRequestGroupsSuccessAndFailure(t *testing.T) {
	original := newDatabaseFunc
	t.Cleanup(func() { newDatabaseFunc = original })
	for _, test := range []struct {
		name       string
		failure    error
		wantStatus string
	}{
		{"success", nil, "success"},
		{"failure", errors.New("invalid query"), "error"},
	} {
		t.Run(test.name, func(t *testing.T) {
			database := &sqlAuditTestDatabase{rows: []map[string]interface{}{{"id": 7}}, columns: []string{"id"}, queryErr: test.failure}
			newDatabaseFunc = func(string) (db.Database, error) { return database, nil }
			application := newSQLAuditTestApp(t)
			config := connection.ConnectionConfig{Type: "postgres", Host: "127.0.0.1", Port: 5432, Database: "app"}
			ctx := sqlaudit.WithMCPContext(context.Background(), sqlaudit.MCPContext{RequestID: "request-" + test.name, Client: "client-fingerprint"})
			result := NewMCPQueryExecutor(application).DBQueryMultiContext(ctx, config, "app", "SELECT id FROM users; SELECT id FROM users", 0)
			if result.Success != (test.failure == nil) {
				t.Fatalf("unexpected result: %+v", result)
			}
			events := loadSQLAuditEvents(t, application, sqlaudit.Filter{MCPRequestID: "request-" + test.name})
			if len(events) < 2 {
				t.Fatalf("missing aggregate/statement audit events: %+v", events)
			}
			for _, event := range events {
				if event.MCPClient != "client-fingerprint" || event.Status != test.wantStatus || event.Source != "mcp" {
					t.Fatalf("incorrect context/status: %+v", event)
				}
			}
			verification := application.VerifySQLAuditIntegrity()
			if !verification.Success {
				t.Fatalf("integrity API failed: %+v", verification)
			}
			report, ok := verification.Data.(sqlaudit.IntegrityReport)
			if !ok || !report.Valid {
				t.Fatalf("invalid audit chain: %+v", verification.Data)
			}
		})
	}
}
