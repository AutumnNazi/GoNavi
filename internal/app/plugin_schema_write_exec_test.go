package app

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/plugin"
)

func TestPluginSchemaApplyExecutesOnlyAfterConfirmation(t *testing.T) {
	a := newPluginTestApp(t)
	a.ctx = context.Background()
	a.headlessRuntime = false
	a.webRuntime = false
	config := connection.ConnectionConfig{Type: "sqlite", Database: filepath.Join(t.TempDir(), "schema.db")}
	probe := a.DBQueryMultiWithOptions(config, "", "SELECT 1", "", QueryResultBudgetOptions{})
	if !probe.Success && (strings.Contains(probe.Message, "SQLite 纯 Go 驱动未启用") || strings.Contains(probe.Message, "SQLite Go driver is not enabled")) {
		t.Skip("SQLite optional driver is not enabled in this test environment")
	}
	if !probe.Success {
		t.Fatalf("sqlite probe failed: %s", probe.Message)
	}
	if _, err := a.savedConnectionRepository().Save(connection.SavedConnectionInput{ID: "schema-exec", Name: "Schema Exec", Config: config}); err != nil {
		t.Fatal(err)
	}
	status := plugin.Status{
		Manifest:       pluginPageTestManifest("test.schema.exec", plugin.SchemaWritePermission),
		Generation:     1,
		State:          plugin.StateRunning,
		DesiredEnabled: true,
	}
	preview := func(sql string) string {
		arguments, _ := json.Marshal(map[string]any{"connectionId": "schema-exec", "statements": []string{sql}})
		raw, err := a.pluginCapabilityCall(context.Background(), status, pluginCapabilityChannelWindow, "schema.preview", arguments)
		if err != nil {
			t.Fatal(err)
		}
		ok, code := decodePluginCapabilityEnvelope(t, raw)
		if !ok || code != "" {
			t.Fatalf("preview envelope: %s", raw)
		}
		var envelope struct {
			Data pluginCapabilitySchemaPreviewResult `json:"data"`
		}
		if err := json.Unmarshal(raw, &envelope); err != nil || envelope.Data.PlanID == "" {
			t.Fatalf("preview data: %s %v", raw, err)
		}
		return envelope.Data.PlanID
	}
	apply := func(planID string) (bool, string) {
		arguments, _ := json.Marshal(map[string]string{"planId": planID})
		raw, err := a.pluginCapabilityCall(context.Background(), status, pluginCapabilityChannelWindow, "schema.apply", arguments)
		if err != nil {
			t.Fatal(err)
		}
		return decodePluginCapabilityEnvelope(t, raw)
	}
	tableExists := func(name string) bool {
		result := a.DBQueryMultiWithOptions(config, "", "SELECT name FROM sqlite_master WHERE type='table' AND name='"+name+"'", "", QueryResultBudgetOptions{})
		if !result.Success {
			t.Fatalf("sqlite check failed: %+v", result)
		}
		data, _ := json.Marshal(result.Data)
		return strings.Contains(string(data), name)
	}

	deniedPlan := preview("CREATE TABLE denied_table (id INTEGER)")
	a.schemaConfirm = func(context.Context, string) (bool, error) { return false, nil }
	if ok, code := apply(deniedPlan); ok || code != "confirmation_denied" {
		t.Fatalf("denied apply envelope: %v %s", ok, code)
	}
	if tableExists("denied_table") {
		t.Fatal("denied DDL was executed")
	}

	allowedPlan := preview("CREATE TABLE allowed_table (id INTEGER)")
	a.schemaConfirm = func(context.Context, string) (bool, error) { return true, nil }
	if ok, code := apply(allowedPlan); !ok || code != "" {
		t.Fatalf("allowed apply envelope: %v %s", ok, code)
	}
	if !tableExists("allowed_table") {
		t.Fatal("confirmed DDL did not execute")
	}
}
