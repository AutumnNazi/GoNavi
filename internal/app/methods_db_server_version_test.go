package app

import (
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
)

func TestDBGetServerVersionReadsCachedMySQLBanner(t *testing.T) {
	app := NewApp()
	config := connection.ConnectionConfig{Type: "mysql", Host: "127.0.0.1", Port: 3306, User: "root"}
	inst := &healthProbeDatabase{version: "5.7.44-log"}
	app.dbCache[getCacheKey(config)] = cachedDatabase{
		inst:     inst,
		config:   normalizeCacheKeyConfig(config),
		lastPing: time.Now(),
	}

	result := app.DBGetServerVersion(config)
	if !result.Success {
		t.Fatalf("expected success, got %#v", result)
	}
	if result.Message != "5.7.44-log" {
		t.Fatalf("version = %q", result.Message)
	}
	if len(inst.queries) != 1 || !strings.Contains(inst.queries[0], "VERSION()") {
		t.Fatalf("queries = %#v", inst.queries)
	}
}

func TestDBGetServerVersionSkipsUnsupportedSourcesWithoutConnecting(t *testing.T) {
	app := NewApp()
	result := app.DBGetServerVersion(connection.ConnectionConfig{Type: "mongodb", Host: "127.0.0.1"})
	if !result.Success {
		t.Fatalf("unsupported sources should succeed empty, got %#v", result)
	}
	if strings.TrimSpace(result.Message) != "" {
		t.Fatalf("expected empty version, got %q", result.Message)
	}
}
