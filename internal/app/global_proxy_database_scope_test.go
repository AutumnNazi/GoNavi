package app

import (
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestResolveEffectiveConnectionConfigUsesOnlyConnectionProxy(t *testing.T) {
	snapshot := currentGlobalProxyConfig()
	if _, err := setGlobalProxyConfig(true, connection.ProxyConfig{
		Type: "socks5",
		Host: "127.0.0.1",
		Port: 1080,
	}); err != nil {
		t.Fatalf("enable global proxy failed: %v", err)
	}
	t.Cleanup(func() {
		_, _ = setGlobalProxyConfig(snapshot.Enabled, snapshot.Proxy)
	})

	app := NewApp()
	directConfig := connection.ConnectionConfig{
		Type: "mysql",
		Host: "db.internal",
		Port: 3306,
	}
	effectiveDirect, err := app.resolveEffectiveConnectionConfig(directConfig)
	if err != nil {
		t.Fatalf("resolve direct config failed: %v", err)
	}
	if effectiveDirect.UseProxy || effectiveDirect.Proxy != (connection.ProxyConfig{}) {
		t.Fatalf("global proxy must not be injected into a direct database connection, got %+v", effectiveDirect)
	}

	connectionProxy := connection.ProxyConfig{
		Type: "http",
		Host: "db-proxy.internal",
		Port: 8080,
		User: "proxy-user",
	}
	proxiedConfig := directConfig
	proxiedConfig.UseProxy = true
	proxiedConfig.Proxy = connectionProxy
	effectiveProxied, err := app.resolveEffectiveConnectionConfig(proxiedConfig)
	if err != nil {
		t.Fatalf("resolve proxied config failed: %v", err)
	}
	if !effectiveProxied.UseProxy || !proxyConfigEqual(effectiveProxied.Proxy, connectionProxy) {
		t.Fatalf("connection-specific proxy must be preserved, got %+v", effectiveProxied)
	}
}
