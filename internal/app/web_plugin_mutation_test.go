package app

import (
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestWebPluginMutationsStayReadOnly(t *testing.T) {
	a := newPluginTestApp(t)
	a.webRuntime = true
	config := connection.ConnectionConfig{Type: "plugin:example.reader:source:postgres", ReadOnly: false}
	for _, call := range []struct {
		name   string
		result connection.QueryResult
	}{
		{name: "apply", result: a.ApplyChanges(config, "app", "people", connection.ChangeSet{})},
		{name: "drop", result: a.DropTable(config, "app", "people")},
		{name: "rename", result: a.RenameTable(config, "app", "people", "persons")},
	} {
		if call.result.Success || call.result.Message == "" {
			t.Fatalf("web %s changed a plugin data source: %+v", call.name, call.result)
		}
	}
}
