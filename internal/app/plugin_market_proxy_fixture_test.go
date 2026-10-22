package app

import (
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestPluginMarketFixtureIsolatesAndRestoresGlobalProxy(t *testing.T) {
	previous := currentGlobalProxyConfig()
	t.Cleanup(func() {
		if _, err := setGlobalProxyConfig(previous.Enabled, previous.Proxy); err != nil {
			t.Error(err)
		}
	})
	if _, err := setGlobalProxyConfig(true, connection.ProxyConfig{Type: "http", Host: "127.0.0.1", Port: 1}); err != nil {
		t.Fatal(err)
	}
	t.Run("local HTTP requests remain deterministic", func(t *testing.T) {
		a := newPluginTestApp(t)
		_, digest, source := newApprovalMarket(t, a)
		inspectedMarketQuote(t, a, digest, source)
	})
	restored := currentGlobalProxyConfig()
	if !restored.Enabled || restored.Proxy.Port != 1 {
		t.Fatal("fixture failed to restore previous proxy preferences")
	}
}
