package app

import (
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestWebPluginQueryRejectsWrite(t *testing.T) {
	a := newPluginTestApp(t)
	a.webRuntime = true
	config := connection.ConnectionConfig{Type: "plugin:example.reader:source:postgres", ReadOnly: false}
	result := a.DBQuery(config, "app", "DELETE FROM demo")
	if result.Success {
		t.Fatalf("web query allowed a plugin write: %s", result.Message)
	}
	if result.Message == "" {
		t.Fatal("web write rejection had no message")
	}
	for _, call := range []struct {
		name   string
		result connection.QueryResult
	}{
		{name: "multi", result: a.DBQueryMulti(config, "app", "DELETE FROM demo", "")},
		{name: "transaction", result: a.DBQueryMultiTransactional(config, "app", "DELETE FROM demo", "")},
	} {
		if call.result.Success || call.result.Message == "" {
			t.Fatalf("web %s allowed a plugin write: %+v", call.name, call.result)
		}
	}
}
