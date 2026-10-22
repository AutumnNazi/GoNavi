package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func driverWriteRequest(operation, transactionID string) json.RawMessage {
	request := DataSourceRequest{ProtocolVersion: DataSourceWriteProtocolVersion, Operation: operation, SessionID: "session_1", TransactionID: transactionID}
	if operation == "query" || operation == "exec" {
		request.Query = "UPDATE people SET name='Ada'"
	}
	encoded, _ := json.Marshal(request)
	return encoded
}

func writableDriverFixture() DataSourceOperations {
	fixture := driverFixture()
	fixture.Exec = func(_ context.Context, request DataSourceRequest) (DataSourceExecResult, error) {
		if request.TransactionID != "" && request.TransactionID != "tx-1" {
			return DataSourceExecResult{}, ErrDataSourceSession
		}
		return DataSourceExecResult{RowsAffected: 2}, nil
	}
	fixture.Begin = func(context.Context, DataSourceRequest) (string, error) { return "tx-1", nil }
	fixture.Commit = func(_ context.Context, request DataSourceRequest) error {
		if request.TransactionID != "tx-1" {
			return ErrDataSourceSession
		}
		return nil
	}
	fixture.Rollback = fixture.Commit
	return fixture
}

func TestDataSourceWriteProtocolDispatchesExecAndTransactions(t *testing.T) {
	dispatcher := NewDataSourceDispatcher(writableDriverFixture())
	if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "session_1")); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ operation, transaction, expected string }{
		{"begin", "", `{"ok":true,"transactionId":"tx-1"}`},
		{"exec", "tx-1", `{"ok":true,"rowsAffected":2}`},
		{"commit", "tx-1", `{"ok":true}`},
		{"rollback", "tx-1", `{"ok":true}`},
	} {
		result, err := dispatcher.Handle(context.Background(), driverWriteRequest(test.operation, test.transaction))
		if err != nil {
			t.Fatalf("%s: %v", test.operation, err)
		}
		encoded, err := json.Marshal(result)
		if err != nil || string(encoded) != test.expected {
			t.Fatalf("%s wire result %s, %v", test.operation, encoded, err)
		}
	}
}

func TestDataSourceWriteProtocolFailsClosedOnInvalidEnvelopes(t *testing.T) {
	dispatcher := NewDataSourceDispatcher(writableDriverFixture())
	if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "session_1")); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{
		`{"protocolVersion":2,"operation":"exec","sessionId":"session_1","transactionId":"tx-1"}`,
		`{"protocolVersion":2,"operation":"exec","sessionId":"session_1","query":"DELETE"}`,
		`{"protocolVersion":2,"operation":"begin","sessionId":"session_1","transactionId":"tx-1"}`,
		`{"protocolVersion":2,"operation":"commit","sessionId":"session_1"}`,
		`{"protocolVersion":2,"operation":"commit","sessionId":"session_1","transactionId":"bad/id"}`,
		`{"protocolVersion":2,"operation":"rollback","sessionId":"session_1","transactionId":"tx-1","query":"SELECT 1"}`,
		`{"protocolVersion":2,"operation":"ping","sessionId":"session_1"}`,
		`{"protocolVersion":1,"operation":"exec","sessionId":"session_1","query":"DELETE"}`,
		`{"protocolVersion":1,"operation":"query","sessionId":"session_1","query":"SELECT 1","transactionId":"tx-1"}`,
	} {
		if _, err := dispatcher.Handle(context.Background(), json.RawMessage(raw)); !errors.Is(err, ErrDataSourceRequest) && !errors.Is(err, ErrDataSourceUnsupported) {
			t.Fatalf("envelope accepted %s: %v", raw, err)
		}
	}
}

func TestDataSourceWriteProtocolRequiresCallbacksAndBoundedIDs(t *testing.T) {
	dispatcher := NewDataSourceDispatcher(driverFixture())
	if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "session_1")); err != nil {
		t.Fatal(err)
	}
	if _, err := dispatcher.Handle(context.Background(), driverWriteRequest("begin", "")); !errors.Is(err, ErrDataSourceUnsupported) {
		t.Fatalf("missing begin callback: %v", err)
	}
	invalid := writableDriverFixture()
	invalid.Begin = func(context.Context, DataSourceRequest) (string, error) { return "two words", nil }
	dispatcher = NewDataSourceDispatcher(invalid)
	if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "session_1")); err != nil {
		t.Fatal(err)
	}
	if _, err := dispatcher.Handle(context.Background(), driverWriteRequest("begin", "")); !errors.Is(err, ErrDataSourceResult) {
		t.Fatalf("malformed transaction id accepted: %v", err)
	}
	negative := writableDriverFixture()
	negative.Exec = func(context.Context, DataSourceRequest) (DataSourceExecResult, error) {
		return DataSourceExecResult{RowsAffected: -1}, nil
	}
	dispatcher = NewDataSourceDispatcher(negative)
	if _, err := dispatcher.Handle(context.Background(), driverRequest("connect", "session_1")); err != nil {
		t.Fatal(err)
	}
	if _, err := dispatcher.Handle(context.Background(), driverWriteRequest("exec", "tx-1")); !errors.Is(err, ErrDataSourceResult) {
		t.Fatalf("negative rows accepted: %v", err)
	}
}
