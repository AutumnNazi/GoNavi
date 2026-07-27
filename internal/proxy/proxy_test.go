package proxy

import (
	"context"
	"strings"
	"testing"
	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/shared/i18n"
)

func TestNormalizeConfigSupportsSocks5hAlias(t *testing.T) {
	cfg, err := NormalizeConfig(connection.ProxyConfig{
		Type: "SOCKS5H",
		Host: "127.0.0.1",
		Port: 1080,
	})
	if err != nil {
		t.Fatalf("NormalizeConfig returned error: %v", err)
	}
	if cfg.Type != "socks5" {
		t.Fatalf("expected normalized proxy type socks5, got %s", cfg.Type)
	}
}

func TestForwarderCacheKeyIncludesCredentialFingerprint(t *testing.T) {
	base := connection.ProxyConfig{
		Type:     "socks5",
		Host:     "127.0.0.1",
		Port:     1080,
		User:     "tester",
		Password: "first-password",
	}
	other := base
	other.Password = "second-password"

	keyA := forwarderCacheKey(base, "db.internal", 3306)
	keyB := forwarderCacheKey(other, "db.internal", 3306)

	if keyA == keyB {
		t.Fatalf("expected different cache key for different credentials")
	}
	if strings.Contains(keyA, base.Password) || strings.Contains(keyB, other.Password) {
		t.Fatalf("cache key should not contain raw password")
	}
}


func TestNormalizeConfigUsesCurrentLanguageForValidationErrors(t *testing.T) {
	SetBackendLanguage(i18n.LanguageEnUS)
	t.Cleanup(func() {
		SetBackendLanguage(i18n.LanguageZhCN)
	})

	_, err := NormalizeConfig(connection.ProxyConfig{
		Type: "Shadowsocks",
		Host: "127.0.0.1",
		Port: 1080,
	})
	if err == nil {
		t.Fatal("expected NormalizeConfig to reject unsupported proxy type")
	}

	const want = "Unsupported proxy type: Shadowsocks"
	if err.Error() != want {
		t.Fatalf("expected localized validation error %q, got %q", want, err.Error())
	}
}

func TestDialContextUsesCurrentLanguageForHTTPConnectWrapper(t *testing.T) {
	SetBackendLanguage(i18n.LanguageEnUS)
	t.Cleanup(func() {
		SetBackendLanguage(i18n.LanguageZhCN)
	})

	_, err := DialContext(context.Background(), connection.ProxyConfig{
		Type: "http",
		Host: "127.0.0.1",
		Port: 1,
	}, "tcp", "example.com:443")
	if err == nil {
		t.Fatal("expected DialContext to fail when proxy endpoint is unreachable")
	}
	if !strings.HasPrefix(err.Error(), "Failed to connect to HTTP proxy:") {
		t.Fatalf("expected localized HTTP proxy wrapper, got %q", err.Error())
	}
}
