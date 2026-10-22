package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
)

func driverRequest(operation, id string) json.RawMessage {
	request := DataSourceRequest{ProtocolVersion: 1, Operation: operation, SessionID: id}
	if operation == "connect" {
		request.Config = &DataSourceConfig{Database: "fixture"}
	}
	if operation == "query" {
		request.Query = "SELECT 1"
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil
	}
	return encoded
}

func driverFixture() DataSourceOperations {
	return DataSourceOperations{
		Connect: func(context.Context, DataSourceRequest) error { return nil },
		Close:   func(context.Context, DataSourceRequest) error { return nil },
		Ping:    func(context.Context, DataSourceRequest) error { return nil },
		Query: func(context.Context, DataSourceRequest) (DataSourceQueryResult, error) {
			return DataSourceQueryResult{Rows: []map[string]any{{"large": int64(9007199254740993)}}, Fields: []string{"large"}}, nil
		},
		AllColumns: func(context.Context, DataSourceRequest) ([]DataSourceColumnDefinitionWithTable, error) {
			return []DataSourceColumnDefinitionWithTable{{TableName: "people", Name: "id", Type: "INTEGER"}}, nil
		},
		Columns: func(context.Context, DataSourceRequest) ([]DataSourceColumnDefinition, error) {
			return []DataSourceColumnDefinition{{Name: "id", Type: "INTEGER", Nullable: "NO", Key: "PRI"}}, nil
		},
		ForeignKeys: func(context.Context, DataSourceRequest) ([]DataSourceForeignKeyDefinition, error) {
			return []DataSourceForeignKeyDefinition{}, nil
		},
	}
}

func TestDataSourceWireValidationAndMetadata(t *testing.T) {
	dispatcher := NewDataSourceDispatcher(driverFixture())
	if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "session_1")); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ operation, expected string }{
		{"query", `{"fields":["large"],"rows":[{"large":"9007199254740993"}]}`},
		{"allColumns", `{"allColumns":[{"tableName":"people","name":"id","type":"INTEGER"}]}`},
		{"columns", `{"columns":[{"name":"id","type":"INTEGER","nullable":"NO","key":"PRI","default":null,"extra":"","comment":""}]}`},
		{"foreignKeys", `{"foreignKeys":[]}`},
	} {
		t.Run(test.operation, func(t *testing.T) {
			result, err := dispatcher.Handle(context.Background(), driverRequest(test.operation, "session_1"))
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(result)
			if err != nil || string(encoded) != test.expected {
				t.Fatalf("wire result %s, %v", encoded, err)
			}
		})
	}
	_, err := dispatcher.Handle(context.Background(), driverRequest("indexes", "session_1"))
	if !errors.Is(err, ErrDataSourceUnsupported) {
		t.Fatalf("unimplemented result=%v", err)
	}
	for _, raw := range []string{
		`{"protocolVersion":2,"operation":"ping","sessionId":"s"}`,
		`{"protocolVersion":1,"operation":"exec","sessionId":"s"}`,
		`{"protocolVersion":1,"operation":"connect","sessionId":"s","config":{"ssh":{"password":"secret"}}}`,
		`{"protocolVersion":1,"operation":"ping","sessionId":"s","config":{}}`,
		`{"protocolVersion":1,"operation":"connect","sessionId":"s","config":{"password":null}}`,
		`{"protocolVersion":1,"operation":"connect","sessionId":"bad/id","config":{}}`,
	} {
		if _, err = dispatcher.Handle(context.Background(), json.RawMessage(raw)); err == nil {
			t.Fatalf("accepted invalid envelope: %s", raw)
		}
	}
	if err = dispatcher.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestDataSourceInvalidOutputIsNotEmptySuccess(t *testing.T) {
	for _, test := range []struct {
		name   string
		result DataSourceQueryResult
	}{
		{name: "null arrays"},
		{name: "unknown field", result: DataSourceQueryResult{Rows: []map[string]any{{"other": 1}}, Fields: []string{"value"}}},
		{name: "too many fields", result: DataSourceQueryResult{Rows: []map[string]any{}, Fields: make([]string, 513)}},
		{name: "oversize", result: DataSourceQueryResult{Rows: []map[string]any{{"value": strings.Repeat("x", DefaultMaxFrameBytes)}}, Fields: []string{"value"}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			operations := driverFixture()
			operations.Query = func(context.Context, DataSourceRequest) (DataSourceQueryResult, error) { return test.result, nil }
			dispatcher := NewDataSourceDispatcher(operations)
			if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "s")); err != nil {
				t.Fatal(err)
			}
			if _, err := dispatcher.Handle(context.Background(), driverRequest("query", "s")); err == nil {
				t.Fatal("invalid result accepted")
			}
		})
	}
}

func TestDataSourceCloseFencesLateConnectAndCleansAgain(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var closes atomic.Int32
	operations := driverFixture()
	operations.Connect = func(context.Context, DataSourceRequest) error { close(started); <-release; return nil }
	operations.Close = func(context.Context, DataSourceRequest) error { closes.Add(1); return nil }
	dispatcher := NewDataSourceDispatcher(operations)
	// One result must remain deliverable even while the test issues close.
	done := make(chan error, 1)
	go func() { _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "s")); done <- err }()
	<-started
	if _, err := dispatcher.Handle(context.Background(), driverRequest("close", "s")); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("late connect=%v", err)
	}
	if closes.Load() != 2 {
		t.Fatalf("cleanup count=%d, want close plus compensating cleanup", closes.Load())
	}
	if _, err := dispatcher.Handle(context.Background(), driverRequest("ping", "s")); !errors.Is(err, ErrDataSourceSession) {
		t.Fatalf("closed session resurrected: %v", err)
	}
	if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "s")); !errors.Is(err, ErrDataSourceSession) {
		t.Fatalf("closed ID reused: %v", err)
	}
}

func TestDataSourceCancellationAndRecentTombstones(t *testing.T) {
	operations := driverFixture()
	entered := make(chan struct{})
	operations.Query = func(ctx context.Context, _ DataSourceRequest) (DataSourceQueryResult, error) {
		close(entered)
		<-ctx.Done()
		return DataSourceQueryResult{}, ctx.Err()
	}
	dispatcher := NewDataSourceDispatcher(operations)
	if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "s")); err != nil {
		t.Fatal(err)
	}
	// One completion does not block the canceled handler before the test can receive it.
	done := make(chan error, 1)
	go func() { _, err := dispatcher.Handle(context.Background(), driverRequest("query", "s")); done <- err }()
	<-entered
	if _, err := dispatcher.Handle(context.Background(), driverRequest("close", "s")); err != nil {
		t.Fatal(err)
	}
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("query cancellation=%v", err)
	}
	for i := 0; i < 4100; i++ {
		id := fmt.Sprintf("metadata_%d", i)
		if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", id)); err != nil {
			t.Fatal(err)
		}
		if _, err := dispatcher.Handle(context.Background(), driverRequest("close", id)); err != nil {
			t.Fatal(err)
		}
	}
	if len(dispatcher.sessions) > 4096 {
		t.Fatal("settled tombstones not bounded")
	}
	if _, err := dispatcher.Handle(context.Background(), driverRequest("close", "never-opened")); err != nil {
		t.Fatal(err)
	}
	if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "never-opened")); !errors.Is(err, ErrDataSourceSession) {
		t.Fatal("close-before-connect was ignored")
	}
}
func TestDataSourcePanickingProviderDoesNotLeakDispatcherSlots(t *testing.T) {
	operations := driverFixture()
	var connectCalls, closeCalls atomic.Int32
	operations.Connect = func(context.Context, DataSourceRequest) error {
		if connectCalls.Add(1) == 1 {
			panic("provider failure")
		}
		return nil
	}
	operations.Close = func(context.Context, DataSourceRequest) error { closeCalls.Add(1); return nil }
	operations.Query = func(context.Context, DataSourceRequest) (DataSourceQueryResult, error) {
		panic("provider query failure")
	}
	dispatcher := NewDataSourceDispatcher(operations)
	canonicalHostID := strings.Repeat("A", 43)
	if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", canonicalHostID)); err == nil {
		t.Fatal("provider panic reported success")
	}
	if dispatcher.active != 0 || dispatcher.connecting != 0 || closeCalls.Load() != 1 {
		t.Fatal("failed connect leaked lifecycle state")
	}
	if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "fresh")); err != nil {
		t.Fatal(err)
	}
	if _, err := dispatcher.Handle(context.Background(), driverRequest("query", "fresh")); err == nil {
		t.Fatal("query panic reported success")
	}
	if len(dispatcher.sessions["fresh"].calls) != 0 {
		t.Fatal("query panic retained active callback")
	}
	if err := dispatcher.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestDataSourceCanceledConnectAndActiveLimit(t *testing.T) {
	operations := driverFixture()
	var calls atomic.Int32
	operations.Connect = func(context.Context, DataSourceRequest) error { calls.Add(1); return nil }
	dispatcher := NewDataSourceDispatcher(operations)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := dispatcher.Handle(ctx, driverRequest("connect", "canceled")); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled connect=%v", err)
	}
	if calls.Load() != 0 {
		t.Fatal("canceled invocation reached provider")
	}
	for i := 0; i < 128; i++ {
		if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", fmt.Sprintf("active_%d", i))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "overflow")); !errors.Is(err, ErrDataSourceLimit) {
		t.Fatalf("active limit=%v", err)
	}
	if err := dispatcher.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "after_stop")); !errors.Is(err, ErrDataSourceSession) {
		t.Fatal("stopped dispatcher reopened")
	}
}
