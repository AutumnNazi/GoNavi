package mcpserver

import (
	"context"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestGetServerVersionReturnsLiveBanner(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID:     "mysql-legacy",
			Name:   "legacy",
			Config: connection.ConnectionConfig{ID: "mysql-legacy", Type: "mysql", Database: "shop"},
		},
		serverVersionResult: connection.QueryResult{
			Success: true,
			Message: "5.7.44-log",
			Data:    []map[string]interface{}{{"version": "5.7.44-log"}},
		},
	}
	service := NewService(backend)
	_, output, err := service.GetServerVersion(context.Background(), nil, connectionIDArgs{ConnectionID: "mysql-legacy"})
	if err != nil {
		t.Fatalf("GetServerVersion error: %v", err)
	}
	if !output.Available || output.Version != "5.7.44-log" {
		t.Fatalf("unexpected version payload %#v", output)
	}
}
