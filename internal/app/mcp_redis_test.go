package app

import (
	"context"
	"io"
	"reflect"
	"testing"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/connection"
	redisbackend "GoNavi-Wails/internal/redis"
	"GoNavi-Wails/internal/sqlaudit"
)

type mcpRedisTestClient struct {
	capturingRedisClient
	args           []string
	result         any
	err            error
	commandContext context.Context
}

func (c *mcpRedisTestClient) ExecuteCommand(args []string) (any, error) {
	c.args = append([]string(nil), args...)
	c.commandContext = redisbackend.MetadataContext(c)
	return c.result, c.err
}

func TestMCPRedisDispatchAndProtections(t *testing.T) {
	tests := []struct {
		name         string
		command      string
		level        ai.SQLPermissionLevel
		readOnly     bool
		allowWrite   bool
		wantSuccess  bool
		wantDispatch bool
		commandErr   error
		wantUnknown  bool
	}{
		{name: "read command on protected connection", command: `GET "key;with semicolon"`, level: ai.PermissionReadOnly, readOnly: true, wantSuccess: true, wantDispatch: true},
		{name: "delete in readwrite", command: "DEL test:key", level: ai.PermissionReadWrite, allowWrite: true, wantSuccess: true, wantDispatch: true},
		{name: "write acknowledgement required", command: "DEL test:key", level: ai.PermissionReadWrite},
		{name: "readonly safety blocks writes", command: "DEL test:key", level: ai.PermissionReadOnly, allowWrite: true},
		{name: "connection protection blocks writes", command: "DEL test:key", level: ai.PermissionReadWrite, readOnly: true, allowWrite: true},
		{name: "flush blocked in readwrite", command: "FLUSHDB", level: ai.PermissionReadWrite, allowWrite: true},
		{name: "unknown write result", command: "INCR test:key", level: ai.PermissionReadWrite, allowWrite: true, wantDispatch: true, commandErr: io.EOF, wantUnknown: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runtime, err := NewHeadlessRuntime(context.Background(), HeadlessRuntimeOptions{DataRoot: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			defer runtime.Close()
			saveHeadlessSafetyLevel(t, runtime, tt.level)
			view, err := runtime.SaveConnection(connection.SavedConnectionInput{
				ID: "redis-test", Name: "Redis test",
				Config: connection.ConnectionConfig{ID: "redis-test", Type: "redis", Host: "localhost", Port: 6379, RedisDB: 0, ReadOnly: tt.readOnly},
			})
			if err != nil {
				t.Fatal(err)
			}
			client := &mcpRedisTestClient{result: int64(1), err: tt.commandErr}
			previous := newRedisClientFunc
			newRedisClientFunc = func() redisbackend.RedisClient { return client }
			defer func() { newRedisClientFunc = previous }()
			ctx := context.WithValue(context.Background(), mcpRedisContextKey{}, "request-marker")
			result := NewMCPQueryExecutor(runtime.app).DBQueryMultiAuthorizedContext(ctx, view.Config, "3", tt.command, tt.allowWrite, 5)
			if result.Success != tt.wantSuccess || result.OutcomeUnknown != tt.wantUnknown {
				t.Fatalf("unexpected result: %#v", result)
			}
			if (len(client.args) > 0) != tt.wantDispatch {
				t.Fatalf("unexpected dispatched args: %v", client.args)
			}
			if tt.wantDispatch {
				if client.connectConfig.RedisDB != 3 || client.closed != 1 {
					t.Fatalf("db=%d closed=%d", client.connectConfig.RedisDB, client.closed)
				}
				if client.commandContext.Value(mcpRedisContextKey{}) != "request-marker" {
					t.Fatal("request context was not forwarded")
				}
				events := loadSQLAuditEvents(t, runtime.app, sqlaudit.Filter{Source: "mcp"})
				if len(events) != 1 || events[0].DBType != "redis" || events[0].Database != "3" || events[0].QueryID != result.QueryID {
					t.Fatalf("missing Redis command audit: %#v", events)
				}
			}
			if tt.wantSuccess {
				sets, ok := result.Data.([]connection.ResultSetData)
				if !ok || len(sets) != 1 || len(sets[0].Rows) != 1 || sets[0].Rows[0]["value"] != int64(1) {
					t.Fatalf("invalid result set: %#v", result.Data)
				}
				if !reflect.DeepEqual(client.args, parseRedisCommand(tt.command)) {
					t.Fatalf("command changed: %v", client.args)
				}
			}
		})
	}
}

type mcpRedisContextKey struct{}
