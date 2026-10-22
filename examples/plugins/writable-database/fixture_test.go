package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func TestWritableFixtureTransactionLifecycle(t *testing.T) {
	dispatcher := plugin.NewDataSourceDispatcher(newFixture().operations())
	defer dispatcher.Close(context.Background())
	session := strings.Repeat("A", 43)
	invoke := func(request plugin.DataSourceRequest) any {
		t.Helper()
		if request.SessionID == "" {
			request.SessionID = session
		}
		if request.ProtocolVersion == 0 {
			request.ProtocolVersion = plugin.DataSourceProtocolVersion
		}
		raw, err := json.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		result, err := dispatcher.Handle(context.Background(), raw)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	invoke(plugin.DataSourceRequest{Operation: "connect", Config: &plugin.DataSourceConfig{Host: "memory", Database: "fixture", Password: "do-not-log"}})
	before := invoke(plugin.DataSourceRequest{Operation: "query", Database: "fixture", Query: "SELECT * FROM people"})
	begin := invoke(plugin.DataSourceRequest{ProtocolVersion: plugin.DataSourceWriteProtocolVersion, Operation: "begin"})
	transactionID, _ := begin.(map[string]any)["transactionId"].(string)
	if transactionID == "" {
		t.Fatalf("begin result: %#v", begin)
	}
	updated := invoke(plugin.DataSourceRequest{ProtocolVersion: plugin.DataSourceWriteProtocolVersion, Operation: "exec", TransactionID: transactionID, Query: "UPDATE people SET name = 'New' WHERE id = 2"})
	if string(mustJSON(t, updated)) != `{"ok":true,"rowsAffected":1}` {
		t.Fatalf("exec result: %#v", updated)
	}
	invoke(plugin.DataSourceRequest{ProtocolVersion: plugin.DataSourceWriteProtocolVersion, Operation: "rollback", TransactionID: transactionID})
	afterRollback := invoke(plugin.DataSourceRequest{Operation: "query", Database: "fixture", Query: "SELECT * FROM people"})
	if !strings.Contains(string(mustJSON(t, afterRollback)), `"Grace"`) || !strings.Contains(string(mustJSON(t, before)), `"Grace"`) {
		t.Fatal("rollback did not restore the fixture")
	}
	begin = invoke(plugin.DataSourceRequest{ProtocolVersion: plugin.DataSourceWriteProtocolVersion, Operation: "begin"})
	transactionID = begin.(map[string]any)["transactionId"].(string)
	invoke(plugin.DataSourceRequest{ProtocolVersion: plugin.DataSourceWriteProtocolVersion, Operation: "exec", TransactionID: transactionID, Query: "UPDATE people SET name = 'New' WHERE id = 2"})
	invoke(plugin.DataSourceRequest{ProtocolVersion: plugin.DataSourceWriteProtocolVersion, Operation: "commit", TransactionID: transactionID})
	afterCommit := invoke(plugin.DataSourceRequest{Operation: "query", Database: "fixture", Query: "SELECT * FROM people"})
	if !strings.Contains(string(mustJSON(t, afterCommit)), `"New"`) {
		t.Fatal("commit did not persist the fixture update")
	}
	if _, err := dispatcher.Handle(context.Background(), mustJSON(t, plugin.DataSourceRequest{ProtocolVersion: plugin.DataSourceWriteProtocolVersion, Operation: "query", SessionID: session, Database: "fixture", Query: "DELETE FROM people"})); err == nil {
		t.Fatal("unsupported write reached the fixture")
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
