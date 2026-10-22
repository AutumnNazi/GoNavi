package db

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func writablePluginDatabaseTest(t *testing.T) (*PluginDatabase, *pluginDatabaseFake) {
	t.Helper()
	status := pluginDatabaseTestStatus()
	status.Manifest.Contributes.DataSources[0].ReadOnly = false
	runtime := &pluginDatabaseFake{status: status}
	database, err := newPluginDatabase(runtime, status, status.Manifest.Contributes.DataSources[0], func(string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	config := pluginDatabaseTestConfig(database)
	config.PluginWritable = true
	if err := database.ConnectContext(t.Context(), config); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("close adapter: %v", err)
		}
	})
	return database, runtime
}

func TestPluginDatabaseWritableExecUsesProtocolTwo(t *testing.T) {
	database, runtime := writablePluginDatabaseTest(t)
	rows, err := database.ExecContext(t.Context(), "UPDATE fixture SET name='Ada'")
	if err != nil || rows != 3 {
		t.Fatalf("exec=%d err=%v", rows, err)
	}
	calls := runtime.requests("exec")
	if len(calls) != 1 || calls[0].request.ProtocolVersion != 2 || calls[0].request.TransactionID != "" || calls[0].request.Query == "" {
		t.Fatalf("unexpected exec call: %#v", calls)
	}
}

func TestPluginDatabaseReadOnlySourceRejectsWritesAndTransactions(t *testing.T) {
	database, runtime := connectedPluginDatabaseTest(t)
	if _, err := database.ExecContext(t.Context(), "DELETE FROM fixture"); !errors.Is(err, ErrPluginDatabaseReadOnly) {
		t.Fatalf("exec on read-only source: %v", err)
	}
	if _, err := database.OpenTransactionExecer(t.Context()); !errors.Is(err, ErrPluginDatabaseReadOnly) {
		t.Fatalf("transaction on read-only source: %v", err)
	}
	if len(runtime.requests("exec")) != 0 || len(runtime.requests("begin")) != 0 {
		t.Fatal("read-only fence dispatched plugin work")
	}
}

func openPluginTransactionTest(t *testing.T, database *PluginDatabase) *PluginTransaction {
	t.Helper()
	opened, err := database.OpenTransactionExecer(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	tx, ok := opened.(*PluginTransaction)
	if !ok {
		t.Fatalf("unexpected transaction handle %T", opened)
	}
	return tx
}

func TestPluginTransactionCommitsWithHostIssuedIdentity(t *testing.T) {
	database, runtime := writablePluginDatabaseTest(t)
	tx := openPluginTransactionTest(t, database)
	if _, err := tx.ExecContext(t.Context(), "INSERT INTO fixture(id) VALUES (1)"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := tx.QueryContext(t.Context(), "SELECT * FROM fixture"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal("commit is not idempotent")
	}
	if _, err := tx.ExecContext(t.Context(), "DELETE FROM fixture"); err == nil {
		t.Fatal("finished transaction accepted work")
	}
	for _, operation := range []string{"exec", "query", "commit"} {
		calls := runtime.requests(operation)
		if len(calls) != 1 || calls[0].request.ProtocolVersion != 2 || calls[0].request.TransactionID != "tx-1" {
			t.Fatalf("%s did not carry transaction identity: %#v", operation, calls)
		}
	}
	if len(runtime.requests("rollback")) != 0 {
		t.Fatal("committed transaction rolled back")
	}
}

func TestPluginTransactionCloseRollsBackOnce(t *testing.T) {
	database, runtime := writablePluginDatabaseTest(t)
	tx := openPluginTransactionTest(t, database)
	if err := tx.Close(); err != nil {
		t.Fatal(err)
	}
	if err := tx.Close(); err != nil {
		t.Fatal(err)
	}
	if len(runtime.requests("rollback")) != 1 {
		t.Fatalf("rollback calls=%d", len(runtime.requests("rollback")))
	}
	if _, _, err := tx.QueryContext(t.Context(), "SELECT 1"); err == nil {
		t.Fatal("closed transaction accepted query")
	}
}

func TestPluginTransactionRejectsMalformedIdentityAndResults(t *testing.T) {
	cases := map[string]json.RawMessage{
		"missing id":    json.RawMessage(`{"ok":true}`),
		"empty id":      json.RawMessage(`{"ok":true,"transactionId":""}`),
		"oversized id":  json.RawMessage(`{"ok":true,"transactionId":"` + strings.Repeat("x", pluginDatabaseMaxTransactionID+1) + `"}`),
		"nul id":        json.RawMessage(`{"ok":true,"transactionId":"tx\u0000"}`),
		"not ok":        json.RawMessage(`{"ok":false,"transactionId":"tx-1"}`),
		"unknown field": json.RawMessage(`{"ok":true,"transactionId":"tx-1","extra":1}`),
	}
	for name, reply := range cases {
		t.Run(name, func(t *testing.T) {
			database, runtime := writablePluginDatabaseTest(t)
			runtime.handler = func(_ context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
				if request.Operation == "begin" {
					return reply, nil
				}
				return pluginDatabaseTestReply(request.Operation), nil
			}
			if _, err := database.OpenTransactionExecer(t.Context()); !errors.Is(err, ErrPluginDatabaseProtocol) {
				t.Fatalf("malformed begin accepted: %v", err)
			}
		})
	}
}

func TestPluginDatabaseWritableExecRejectsMalformedReply(t *testing.T) {
	for _, reply := range []string{`{"ok":true,"rowsAffected":-1}`, `{"ok":true,"rowsAffected":"3"}`, `{"ok":true}`, `{"ok":false,"rowsAffected":0}`, `{"ok":true,"rowsAffected":1,"extra":1}`} {
		t.Run(reply, func(t *testing.T) {
			database, runtime := writablePluginDatabaseTest(t)
			runtime.handler = func(_ context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
				return json.RawMessage(reply), nil
			}
			if _, err := database.ExecContext(t.Context(), "DELETE FROM fixture"); !errors.Is(err, ErrPluginDatabaseProtocol) {
				t.Fatalf("malformed exec reply accepted: %v", err)
			}
		})
	}
}

func TestPluginDatabaseWritableQuerySkipsReadOnlySQLPolicy(t *testing.T) {
	database, runtime := writablePluginDatabaseTest(t)
	rows, _, err := database.QueryContext(t.Context(), "WITH changed AS (UPDATE fixture SET name='Ada' RETURNING id) SELECT * FROM changed")
	if err != nil || len(rows) != 1 {
		t.Fatalf("writable query rejected: %v", err)
	}
	if len(runtime.requests("query")) != 1 {
		t.Fatal("query not dispatched")
	}
}

func TestPluginDatabaseWritableGenerationFenceAppliesToTransactions(t *testing.T) {
	database, runtime := writablePluginDatabaseTest(t)
	tx := openPluginTransactionTest(t, database)
	runtime.mu.Lock()
	runtime.status.Generation++
	runtime.mu.Unlock()
	if err := tx.Commit(); !errors.Is(err, ErrPluginDatabaseUnavailable) {
		t.Fatalf("stale transaction commit: %v", err)
	}
	if len(runtime.requests("commit")) != 0 {
		t.Fatal("stale transaction reached replacement generation")
	}
}

func TestPluginDatabaseWritableDeclarationSurvivesManifestValidation(t *testing.T) {
	status := pluginDatabaseTestStatus()
	status.Manifest.Contributes.DataSources[0].ReadOnly = false
	if err := plugin.ValidateManifest(status.Manifest); err != nil {
		t.Fatalf("writable declaration rejected: %v", err)
	}
}
