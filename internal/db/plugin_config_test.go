package db

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
)

func TestPluginDatabaseConnectProjectsOnlySelectedFields(t *testing.T) {
	database, runtime := newPluginDatabaseTest(t)
	config := pluginDatabaseTestConfig(database)
	config.ID = "host-connection-id"
	config.SSH.Password = "unrelated-ssh-secret"
	config.Proxy.Password = "unrelated-proxy-secret"
	config.HTTPTunnel.Password = "unrelated-tunnel-secret"
	config.RedisSentinelPassword = "unrelated-sentinel-secret"
	config.MetadataScope = &connection.MetadataDiscoveryScope{}
	config = config.WithRuntimeDatabaseOverride("selected-database")
	if err := database.ConnectContext(t.Context(), config); err != nil {
		t.Fatal(err)
	}
	request := runtime.requests("connect")[0].request
	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	for _, excluded := range []string{"host-connection-id", "unrelated-", "metadataScope", "ssh", "proxy", "readOnly", "timeout", "dsn"} {
		if strings.Contains(string(payload), excluded) {
			t.Fatalf("unexpected config field/secret sent: %s", excluded)
		}
	}
	if request.Config == nil || request.Config.Password != "selected-password" || request.Config.Database != "selected-database" || request.Config.ConnectionParams != "mode=readonly" {
		t.Fatal("selected config projection changed")
	}
	if err := database.PingContext(t.Context()); err != nil {
		t.Fatal(err)
	}
	if runtime.requests("ping")[0].request.Config != nil {
		t.Fatal("credentials resent on ordinary operation")
	}
}

func TestPluginDatabaseRejectsUnsupportedTransportExtras(t *testing.T) {
	cases := map[string]func(*connection.ConnectionConfig){
		"ssh":              func(c *connection.ConnectionConfig) { c.UseSSH = true },
		"proxy":            func(c *connection.ConnectionConfig) { c.UseProxy = true },
		"tunnel":           func(c *connection.ConnectionConfig) { c.UseHTTPTunnel = true },
		"tls":              func(c *connection.ConnectionConfig) { c.UseSSL = true },
		"sslMode":          func(c *connection.ConnectionConfig) { c.SSLMode = "required" },
		"sslCA":            func(c *connection.ConnectionConfig) { c.SSLCAPath = "private-ca" },
		"sslCert":          func(c *connection.ConnectionConfig) { c.SSLCertPath = "private-cert" },
		"sslKey":           func(c *connection.ConnectionConfig) { c.SSLKeyPath = "private-key" },
		"dsn":              func(c *connection.ConnectionConfig) { c.DSN = "host-private-dsn" },
		"uri":              func(c *connection.ConnectionConfig) { c.URI = "sqlite://private" },
		"driver":           func(c *connection.ConnectionConfig) { c.Driver = "jdbc" },
		"variant":          func(c *connection.ConnectionConfig) { c.DriverVariant = "jdbc" },
		"hosts":            func(c *connection.ConnectionConfig) { c.Hosts = []string{"a", "b"} },
		"topology":         func(c *connection.ConnectionConfig) { c.Topology = "cluster" },
		"replica":          func(c *connection.ConnectionConfig) { c.ReplicaSet = "set" },
		"jvm":              func(c *connection.ConnectionConfig) { c.JVM.JMX.Enabled = true },
		"wrongType":        func(c *connection.ConnectionConfig) { c.Type = "mysql" },
		"port":             func(c *connection.ConnectionConfig) { c.Port = 65536 },
		"timeout":          func(c *connection.ConnectionConfig) { c.Timeout = 3601 },
		"queryTimeout":     func(c *connection.ConnectionConfig) { c.QueryTimeout = -1 },
		"hostLength":       func(c *connection.ConnectionConfig) { c.Host = strings.Repeat("x", pluginDatabaseMaxName+1) },
		"hostBytes":        func(c *connection.ConnectionConfig) { c.Host = strings.Repeat("中", 342) },
		"credentialLength": func(c *connection.ConnectionConfig) { c.Password = strings.Repeat("s", pluginDatabaseMaxText+1) },
		"credentialBytes":  func(c *connection.ConnectionConfig) { c.Password = strings.Repeat("文", 21846) },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			database, runtime := newPluginDatabaseTest(t)
			config := pluginDatabaseTestConfig(database)
			change(&config)
			if err := database.ConnectContext(t.Context(), config); err == nil {
				t.Fatal("unsupported config accepted")
			}
			if len(runtime.requests("connect")) != 0 {
				t.Fatal("rejected config reached plugin")
			}
		})
	}
}

func TestPluginDatabaseConnectionAndQueryTimeoutAreIndependent(t *testing.T) {
	database, runtime := newPluginDatabaseTest(t)
	config := pluginDatabaseTestConfig(database)
	config.Timeout = 1
	config.QueryTimeout = 3
	runtime.handler = func(ctx context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
		deadline, ok := ctx.Deadline()
		if !ok {
			t.Error("missing configured deadline")
		}
		left := time.Until(deadline)
		switch request.Operation {
		case "connect", "ping":
			if left > time.Second || left < 500*time.Millisecond {
				t.Errorf("connect/ping timeout=%v", left)
			}
		case "query":
			if left > 3*time.Second || left < 2*time.Second {
				t.Errorf("query inherited wrong timeout=%v", left)
			}
		}
		return pluginDatabaseTestReply(request.Operation), nil
	}
	if err := database.ConnectContext(t.Context(), config); err != nil {
		t.Fatal(err)
	}
	if _, _, err := database.QueryContext(t.Context(), "SELECT 1"); err != nil {
		t.Fatal(err)
	}
	if err := database.PingContext(t.Context()); err != nil {
		t.Fatal(err)
	}
}
