package db

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/plugin"
)

func TestPluginDatabaseMetadataUsesStandardDTOs(t *testing.T) {
	database, runtime := connectedPluginDatabaseTest(t)
	if values, err := database.GetDatabases(); err != nil || len(values) != 1 {
		t.Fatalf("databases=%v err=%v", values, err)
	}
	if values, err := database.GetTables("selected"); err != nil || len(values) != 1 {
		t.Fatalf("tables=%v err=%v", values, err)
	}
	if value, err := database.GetCreateStatement("selected", "fixture"); err != nil || value == "" {
		t.Fatalf("statement err=%v", err)
	}
	if values, err := database.GetColumns("selected", "fixture"); err != nil || len(values) != 1 || values[0].Nullable != "NO" {
		t.Fatalf("columns err=%v", err)
	}
	if values, err := database.GetAllColumns("selected"); err != nil || len(values) != 1 || values[0].TableName != "fixture" {
		t.Fatalf("allColumns err=%v", err)
	}
	if values, err := database.GetIndexes("selected", "fixture"); err != nil || len(values) != 1 || values[0].SeqInIndex != 1 {
		t.Fatalf("indexes err=%v", err)
	}
	if values, err := database.GetForeignKeys("selected", "fixture"); err != nil || len(values) != 1 || values[0].RefTableName != "parent" {
		t.Fatalf("foreignKeys err=%v", err)
	}
	if values, err := database.GetTriggers("selected", "fixture"); err != nil || len(values) != 1 || values[0].Timing != "AFTER" {
		t.Fatalf("triggers err=%v", err)
	}
	for _, operation := range []string{"tables", "createStatement", "columns", "allColumns", "indexes", "foreignKeys", "triggers"} {
		call := runtime.requests(operation)[0]
		if call.request.Database != "selected" || call.request.Config != nil || call.request.SessionID != database.sessionID {
			t.Fatal("metadata used wrong session/config")
		}
	}
}

func TestPluginDatabaseRejectsMalformedColumnMetadata(t *testing.T) {
	required := []string{"name", "type", "nullable", "key", "default", "extra", "comment"}
	base := `{"name":"id","type":"INTEGER","nullable":"NO","key":"PRI","default":null,"extra":"","comment":""}`
	for name, payload := range map[string]string{
		"null": "null", "nullRow": "[null]", "missing": `[{"name":"id"}]`,
		"wrongType":    `[{"name":1,"type":"INT","nullable":"NO","key":"","default":null,"extra":"","comment":""}]`,
		"unknown":      `[{"name":"id","type":"INT","nullable":"NO","key":"","default":null,"extra":"","comment":"","execute":"bad"}]`,
		"caseAlias":    `[{"name":"id","Name":"other","type":"INT","nullable":"NO","key":"","default":null,"extra":"","comment":""}]`,
		"nullOptional": `[{"name":"id","type":"INT","nullable":"NO","key":"","default":null,"extra":"","comment":"","charset":null}]`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := decodePluginDatabaseArray[connection.ColumnDefinition](json.RawMessage(payload), required); err == nil {
				t.Fatal("malformed metadata accepted")
			}
		})
	}
	columns, err := decodePluginDatabaseArray[connection.ColumnDefinition](json.RawMessage("["+base+"]"), required)
	if err != nil || validatePluginColumns(columns) != nil {
		t.Fatal("valid columns rejected")
	}
	invalid := append([]connection.ColumnDefinition(nil), columns...)
	invalid[0].Nullable = "maybe"
	if validatePluginColumns(invalid) == nil {
		t.Fatal("invalid nullable accepted")
	}
	if validatePluginColumns(append(columns, columns[0])) == nil {
		t.Fatal("duplicate column accepted")
	}
}

func TestPluginDatabaseMetadataValueValidators(t *testing.T) {
	if err := validatePluginAllColumns([]connection.ColumnDefinitionWithTable{{Name: "id", Type: "INT"}}); err == nil {
		t.Fatal("missing table accepted")
	}
	if err := validatePluginIndexes([]connection.IndexDefinition{{Name: "i", ColumnName: "id", NonUnique: 2, SeqInIndex: 1, IndexType: "BTREE"}}); err == nil {
		t.Fatal("invalid uniqueness accepted")
	}
	if err := validatePluginForeignKeys([]connection.ForeignKeyDefinition{{Name: "fk"}}); err == nil {
		t.Fatal("incomplete FK accepted")
	}
	if err := validatePluginTriggers([]connection.TriggerDefinition{{Name: "t", Timing: "ANYTIME", Event: "INSERT", Statement: "SELECT 1"}}); err == nil {
		t.Fatal("invalid trigger timing accepted")
	}
	if err := validatePluginMetadataRequest(pluginDatabaseRequest{Operation: "columns"}); err == nil {
		t.Fatal("missing requested table accepted")
	}
}

func TestPluginDatabaseMalformedMetadataNeverBecomesEmptySuccess(t *testing.T) {
	database, runtime := connectedPluginDatabaseTest(t)
	runtime.handler = func(_ context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
		if request.Operation == "allColumns" {
			return json.RawMessage(`{"columns":[]}`), nil
		}
		return pluginDatabaseTestReply(request.Operation), nil
	}
	result, err := database.GetAllColumns("fixture")
	if !errors.Is(err, ErrPluginDatabaseProtocol) || result != nil {
		t.Fatal("unsupported envelope returned empty success")
	}
	if database.IsCurrent() {
		t.Fatal("malformed protocol did not invalidate session")
	}
}

func TestPluginDatabaseExpiredCloseContextStillCancelsLocally(t *testing.T) {
	database, runtime := connectedPluginDatabaseTest(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := database.CloseContext(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal("expired close context ignored")
	}
	if database.IsCurrent() || len(runtime.requests("close")) != 0 {
		t.Fatal("expired close did not stay local")
	}
	if _, _, err := database.QueryContext(t.Context(), "SELECT 1"); !errors.Is(err, ErrPluginDatabaseClosed) {
		t.Fatal("expired budget left session open")
	}
}

func TestPluginDatabaseCloseDistinguishesGoneRuntimeFromProviderFailure(t *testing.T) {
	for name, cause := range map[string]error{"disabled": plugin.ErrDisabled, "closed": plugin.ErrClosed, "missing": plugin.ErrNotFound, "provider": errors.New("live provider cleanup failure")} {
		t.Run(name, func(t *testing.T) {
			database, runtime := connectedPluginDatabaseTest(t)
			runtime.handler = func(_ context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
				if request.Operation == "close" {
					return nil, cause
				}
				return pluginDatabaseTestReply(request.Operation), nil
			}
			err := database.Close()
			if name == "provider" {
				if !errors.Is(err, cause) {
					t.Fatal("real cleanup failure hidden")
				}
			} else if err != nil {
				t.Fatalf("gone runtime cleanup=%v", err)
			}
			if database.IsCurrent() {
				t.Fatal("local session was not closed")
			}
		})
	}
}
