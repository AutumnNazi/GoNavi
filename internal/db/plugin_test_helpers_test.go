package db

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/plugin"
)

type pluginDatabaseInvocation struct {
	id         string
	generation uint64
	sourceID   string
	request    pluginDatabaseRequest
}

type pluginDatabaseFake struct {
	mu      sync.Mutex
	status  plugin.Status
	calls   []pluginDatabaseInvocation
	handler func(context.Context, pluginDatabaseRequest) (json.RawMessage, error)
}

func (f *pluginDatabaseFake) List() []plugin.Status {
	f.mu.Lock()
	defer f.mu.Unlock()
	return []plugin.Status{f.status}
}

func (f *pluginDatabaseFake) InvokeDataSourceGeneration(ctx context.Context, id string, generation uint64, sourceID string, args json.RawMessage) (json.RawMessage, error) {
	var request pluginDatabaseRequest
	if err := json.Unmarshal(args, &request); err != nil {
		return nil, err
	}
	f.mu.Lock()
	f.calls = append(f.calls, pluginDatabaseInvocation{id: id, generation: generation, sourceID: sourceID, request: request})
	handler := f.handler
	f.mu.Unlock()
	if handler != nil {
		return handler(ctx, request)
	}
	return pluginDatabaseTestReply(request.Operation), nil
}

func (f *pluginDatabaseFake) requests(operation string) []pluginDatabaseInvocation {
	f.mu.Lock()
	defer f.mu.Unlock()
	result := make([]pluginDatabaseInvocation, 0)
	for _, call := range f.calls {
		if call.request.Operation == operation {
			result = append(result, call)
		}
	}
	return result
}

func pluginDatabaseTestReply(operation string) json.RawMessage {
	switch operation {
	case "query":
		return json.RawMessage(`{"rows":[{"id":1,"name":"Ada"}],"fields":["id","name"]}`)
	case "databases", "tables":
		return json.RawMessage(`{"names":["fixture"]}`)
	case "createStatement":
		return json.RawMessage(`{"statement":"CREATE TABLE fixture (id INTEGER)"}`)
	case "exec":
		return json.RawMessage(`{"ok":true,"rowsAffected":3}`)
	case "begin":
		return json.RawMessage(`{"ok":true,"transactionId":"tx-1"}`)
	case "commit", "rollback":
		return json.RawMessage(`{"ok":true}`)
	case "columns":
		return json.RawMessage(`{"columns":[{"name":"id","type":"INTEGER","nullable":"NO","key":"PRI","default":null,"extra":"","comment":""}]}`)
	case "allColumns":
		return json.RawMessage(`{"allColumns":[{"tableName":"fixture","name":"id","type":"INTEGER"}]}`)
	case "indexes":
		return json.RawMessage(`{"indexes":[{"name":"PRIMARY","columnName":"id","nonUnique":0,"seqInIndex":1,"indexType":"BTREE"}]}`)
	case "foreignKeys":
		return json.RawMessage(`{"foreignKeys":[{"name":"fk_id","columnName":"id","refTableName":"parent","refColumnName":"id","constraintName":"fk_id"}]}`)
	case "triggers":
		return json.RawMessage(`{"triggers":[{"name":"trigger_id","timing":"AFTER","event":"INSERT","statement":"SELECT 1","orientation":"ROW"}]}`)
	default:
		return json.RawMessage(`{"ok":true}`)
	}
}

func pluginDatabaseTestStatus() plugin.Status {
	source := plugin.DataSource{ID: "readonly", Name: "Fixture database", Dialect: "sqlite", Command: "driver", ReadOnly: true}
	return plugin.Status{Manifest: plugin.Manifest{SchemaVersion: 1, APIVersion: 1, ID: "test.database", Name: "Database fixture", Version: "1.0.0",
		Permissions: []string{"data.sources"}, Backend: &plugin.Backend{Default: &plugin.Entry{Executable: "driver"}},
		Contributes: plugin.Contributions{Commands: []plugin.Command{{ID: "driver", Title: "Driver"}}, DataSources: []plugin.DataSource{source}}},
		Digest: strings.Repeat("a", 64), InstalledAt: "2026-01-01T00:00:00Z", State: plugin.StateRunning, DesiredEnabled: true, Generation: 7}
}

func newPluginDatabaseTest(t *testing.T) (*PluginDatabase, *pluginDatabaseFake) {
	t.Helper()
	runtime := &pluginDatabaseFake{status: pluginDatabaseTestStatus()}
	database, err := newPluginDatabase(runtime, runtime.status, runtime.status.Manifest.Contributes.DataSources[0], func(query string) error {
		if !strings.HasPrefix(query, "SELECT ") {
			return fmt.Errorf("read-only fixture rejected statement")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("close adapter: %v", err)
		}
	})
	return database, runtime
}

func pluginDatabaseTestConfig(database *PluginDatabase) connection.ConnectionConfig {
	return connection.ConnectionConfig{Type: database.connectionType, Host: "selected-host", Port: 1234, User: "selected-user", Password: "selected-password", Database: "fixture", ConnectionParams: "mode=readonly"}
}

func connectedPluginDatabaseTest(t *testing.T) (*PluginDatabase, *pluginDatabaseFake) {
	t.Helper()
	database, runtime := newPluginDatabaseTest(t)
	if err := database.ConnectContext(t.Context(), pluginDatabaseTestConfig(database)); err != nil {
		t.Fatal(err)
	}
	return database, runtime
}

func waitPluginDatabaseSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(2 * time.Second):
		t.Fatal("plugin database operation did not settle")
	}
}
