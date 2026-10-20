package mcpserver

import (
	"context"
	"testing"

	"GoNavi-Wails/internal/ai"
	appcore "GoNavi-Wails/internal/app"
	"GoNavi-Wails/internal/connection"
)

type redisInspectBackend struct {
	*fakeBackend
}

func (b *redisInspectBackend) InspectSQL(dbType, query string) appcore.SQLInspection {
	return appcore.InspectSQL(dbType, query)
}

func TestExecuteRedisCommandSafety(t *testing.T) {
	tests := []struct {
		name     string
		command  string
		level    ai.SQLPermissionLevel
		allowed  bool
		readOnly bool
	}{
		{"get readonly", "GET test:counter", ai.PermissionReadOnly, true, true},
		{"ttl readonly", "TTL test:counter", ai.PermissionReadOnly, true, true},
		{"scan readwrite", "SCAN 0 MATCH test:* COUNT 10", ai.PermissionReadWrite, true, true},
		{"quoted semicolon is a key", `GET "test:key;DEL other"`, ai.PermissionReadOnly, true, true},
		{"set readwrite", `SET test:key "value;with semicolons"`, ai.PermissionReadWrite, true, false},
		{"del readwrite", "DEL test:counter", ai.PermissionReadWrite, true, false},
		{"del readonly", "DEL test:counter", ai.PermissionReadOnly, false, false},
		{"getdel is a write", "GETDEL test:counter", ai.PermissionReadOnly, false, false},
		{"getex is a write", "GETEX test:counter EX 30", ai.PermissionReadOnly, false, false},
		{"flushdb readwrite", "FLUSHDB", ai.PermissionReadWrite, false, false},
		{"flushall readwrite", "FLUSHALL", ai.PermissionReadWrite, false, false},
		{"eval readwrite", `EVAL "return redis.call('DEL', KEYS[1])" 1 test:counter`, ai.PermissionReadWrite, false, false},
		{"sort store readwrite", "SORT test:list STORE test:sorted", ai.PermissionReadWrite, false, false},
		{"unknown readwrite", "NEWCOMMAND test:key", ai.PermissionReadWrite, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			backend := &redisInspectBackend{&fakeBackend{
				editableConnection: connection.SavedConnectionView{ID: "redis-test", Config: connection.ConnectionConfig{Type: "redis", Database: "0"}},
				safetyLevel:        tt.level,
				queryResult:        connection.QueryResult{Success: true, Data: []connection.ResultSetData{}},
			}}
			result, out, err := NewService(backend).ExecuteSQL(context.Background(), nil, executeSQLArgs{
				ConnectionID: "redis-test", SQL: tt.command,
			})
			if err != nil {
				t.Fatal(err)
			}
			if result == nil || result.IsError == tt.allowed || backend.queryCalled != tt.allowed {
				t.Fatalf("allowed=%t called=%t result=%#v text=%s", tt.allowed, backend.queryCalled, result, firstTextContent(result))
			}
			if tt.allowed && (out.ReadOnly != tt.readOnly || out.StatementCount != 1) {
				t.Fatalf("unexpected command inspection: %#v", out)
			}
		})
	}
}
