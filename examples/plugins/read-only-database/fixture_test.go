package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func TestFixtureSQLSubsetAndMetadata(t *testing.T) {
	dispatcher := plugin.NewDataSourceDispatcher(newFixture().operations())
	session := strings.Repeat("A", 43)
	invoke := func(operation, query, table string) (any, error) {
		request := plugin.DataSourceRequest{ProtocolVersion: 1, Operation: operation, SessionID: session, Database: "fixture", Query: query, Table: table}
		if operation == "connect" {
			request.Database = ""
			request.Config = &plugin.DataSourceConfig{Host: "memory", Database: "fixture", User: "test-user", Password: "do-not-log"}
		}
		raw, err := json.Marshal(request)
		if err != nil {
			return nil, err
		}
		return dispatcher.Handle(context.Background(), raw)
	}
	if _, err := invoke("connect", "", ""); err != nil {
		t.Fatal(err)
	}
	defer dispatcher.Close(context.Background())
	for _, query := range []string{"SELECT 1", "SELECT 1 AS value", `SELECT * FROM "people" LIMIT 1 OFFSET 1`, "SELECT id, name FROM people", "SELECT COUNT(*) AS count FROM people", "SELECT * FROM people LIMIT 0"} {
		t.Run(query, func(t *testing.T) {
			if _, err := invoke("query", query, ""); err != nil {
				t.Fatal(err)
			}
		})
	}
	for _, query := range []string{"DELETE FROM people", "SELECT * FROM secrets", "SELECT 1; DELETE FROM people", "SELECT * FROM people --comment", `SELECT * FROM "people`, "SELECT COUNT(*) AS count FROM people LIMIT 0"} {
		t.Run(query, func(t *testing.T) {
			if _, err := invoke("query", query, ""); err == nil {
				t.Fatal("unsupported SQL was accepted")
			}
		})
	}
	for _, operation := range []string{"databases", "tables", "allColumns", "columns", "indexes", "foreignKeys", "triggers", "createStatement"} {
		t.Run(operation, func(t *testing.T) {
			table := ""
			if operation != "databases" && operation != "tables" && operation != "allColumns" {
				table = "people"
			}
			if _, err := invoke(operation, "", table); err != nil {
				t.Fatal(err)
			}
		})
	}
}
