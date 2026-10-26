package app

import (
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/mockdata"
	syncengine "GoNavi-Wails/internal/sync"
)

func TestWebPluginImportsStayReadOnly(t *testing.T) {
	a := newPluginTestApp(t)
	a.webRuntime = true
	config := connection.ConnectionConfig{Type: "plugin:example.reader:source:postgres", ReadOnly: false}
	for _, call := range []struct {
		name   string
		result connection.QueryResult
	}{
		{name: "import", result: a.ImportData(config, "app", "people")},
		{name: "mock", result: a.MockDataGenerate(config, "app", "people", mockdata.Plan{}, MockDataRunOptions{})},
		{name: "copy", result: a.CopyTable(config, "app", "public", "people")},
	} {
		if call.result.Success || call.result.Message == "" {
			t.Fatalf("web %s wrote a plugin data source: %+v", call.name, call.result)
		}
	}
	if err := ensureDataSyncTargetProtection(syncengine.SyncConfig{TargetConfig: config}); err == nil {
		t.Fatal("data sync accepted a plugin target")
	}
}
