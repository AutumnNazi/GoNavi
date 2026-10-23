package market

import (
	"errors"
	"net/netip"
	"net/url"
	"strings"
	"testing"

	"github.com/lib/pq"
)

func disposablePostgresConfig(raw string) (pq.Config, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Host == "" {
		return pq.Config{}, errors.New("explicit postgres URL required")
	}
	config, err := pq.NewConfig(raw)
	if err != nil {
		return pq.Config{}, errors.New("test postgres configuration invalid")
	}
	if len(config.Multi) != 0 || !strings.HasSuffix(config.Database, "_test") || strings.ContainsAny(config.Database, "/\\") || config.Database != strings.TrimPrefix(u.Path, "/") {
		return pq.Config{}, errors.New("unsafe test database or multiple targets")
	}
	host, parseErr := netip.ParseAddr(config.Host)
	if config.Host != "localhost" && (parseErr != nil || !host.Unmap().IsLoopback()) {
		return pq.Config{}, errors.New("non-loopback test host")
	}
	if config.Hostaddr.IsValid() && !config.Hostaddr.Unmap().IsLoopback() {
		return pq.Config{}, errors.New("non-loopback effective address")
	}
	if !config.Hostaddr.IsValid() {
		if config.Host == "localhost" {
			config.Hostaddr = netip.AddrFrom4([4]byte{127, 0, 0, 1})
		} else {
			config.Hostaddr = host.Unmap()
		}
	}
	// Freeze the parsed target and remove inherited startup options before any connection.
	config.Options = ""
	config.Runtime = map[string]string{}
	return config, nil
}

func TestPostgresTargetGuardRejectsEffectiveOverrides(t *testing.T) {
	t.Setenv("PGHOSTADDR", "127.0.0.1")
	cases := []struct {
		name, dsn string
		valid     bool
	}{
		{name: "explicit local", dsn: "postgres://127.0.0.1/market_test?sslmode=disable", valid: true},
		{name: "localhost pinned", dsn: "postgres://localhost/market_test", valid: true},
		{name: "remote host", dsn: "postgres://203.0.113.10/market_test"},
		{name: "hostaddr override", dsn: "postgres://127.0.0.1/market_test?hostaddr=203.0.113.10"},
		{name: "host override", dsn: "postgres://127.0.0.1/market_test?host=203.0.113.10"},
		{name: "database override", dsn: "postgres://127.0.0.1/market_test?dbname=production"},
		{name: "multiple targets", dsn: "postgres://127.0.0.1/market_test?hostaddr=127.0.0.1,203.0.113.10&host=localhost,remote"},
		{name: "non-test database", dsn: "postgres://127.0.0.1/production"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			config, err := disposablePostgresConfig(test.dsn)
			if (err == nil) != test.valid {
				t.Fatalf("valid=%v err=%v", test.valid, err)
			}
			if err == nil && !config.Hostaddr.IsLoopback() {
				t.Fatal("target was not frozen to loopback")
			}
		})
	}
	t.Setenv("PGHOSTADDR", "203.0.113.10")
	if _, err := disposablePostgresConfig("postgres://127.0.0.1/market_test"); err == nil {
		t.Fatal("inherited remote hostaddr accepted")
	}
}
