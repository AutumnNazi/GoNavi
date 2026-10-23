package app

import (
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestMCPPluginSQLIgnoresMutatingApproval(t *testing.T) {
	a := newPluginTestApp(t)
	config := connection.ConnectionConfig{Type: "plugin:example.reader:source:postgres", ReadOnly: false}
	if err := a.AuthorizeMCPConnectionSQL(config, "DELETE FROM demo"); err == nil {
		t.Fatal("MCP allowed a plugin write")
	}
	if err := a.AuthorizeMCPConnectionSQL(config, "SELECT 1"); err != nil {
		t.Fatal(err)
	}
}
