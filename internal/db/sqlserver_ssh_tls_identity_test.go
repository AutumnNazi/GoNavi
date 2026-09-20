//go:build gonavi_full_drivers || gonavi_sqlserver_driver

package db

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"net/url"
	"strings"
	"sync"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/ssh"
)

const sqlServerIdentityProbeDriverName = "gonavi-sqlserver-identity-probe"

var (
	registerSQLServerIdentityProbeDriver sync.Once
	sqlServerIdentityConnectSeamsMu      sync.Mutex
)

type sqlServerIdentityProbeDriver struct{}

type sqlServerIdentityProbeConn struct{}

func (sqlServerIdentityProbeDriver) Open(string) (driver.Conn, error) {
	return sqlServerIdentityProbeConn{}, nil
}

func (sqlServerIdentityProbeConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("not implemented")
}

func (sqlServerIdentityProbeConn) Close() error { return nil }

func (sqlServerIdentityProbeConn) Begin() (driver.Tx, error) {
	return nil, errors.New("not implemented")
}

func (sqlServerIdentityProbeConn) Ping(context.Context) error { return nil }

func openSQLServerIdentityProbeDB(t *testing.T) (*sql.DB, error) {
	t.Helper()
	registerSQLServerIdentityProbeDriver.Do(func() {
		sql.Register(sqlServerIdentityProbeDriverName, sqlServerIdentityProbeDriver{})
	})
	return sql.Open(sqlServerIdentityProbeDriverName, "")
}

func TestSQLServerDSNSSHForwardKeepsRemoteAzureIdentity(t *testing.T) {
	t.Parallel()

	s := &SqlServerDB{}
	cfg := connection.ConnectionConfig{
		Host:     "127.0.0.1",
		Port:     58228,
		User:     "sa",
		Password: "pass",
		Database: "appdb",
	}
	dsn := s.dsnForRemoteHost(cfg, "myserver.database.windows.net")
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse sqlserver ssh dsn: %v", err)
	}
	query := parsed.Query()
	if got := parsed.Host; got != "127.0.0.1:58228" {
		t.Fatalf("dial host = %q, want local forward endpoint", got)
	}
	if got := strings.ToLower(query.Get("encrypt")); got != "true" {
		t.Fatalf("azure encrypt after SSH forward = %q, want true", query.Get("encrypt"))
	}
	if got := query.Get("hostnameincertificate"); got != "*.database.windows.net" {
		t.Fatalf("azure hostnameincertificate after SSH forward = %q, want *.database.windows.net", got)
	}
}

func TestSQLServerDSNSSHForwardKeepsRemoteOnPremIdentity(t *testing.T) {
	t.Parallel()

	s := &SqlServerDB{}
	cfg := connection.ConnectionConfig{
		Host:     "127.0.0.1",
		Port:     58228,
		User:     "sa",
		Password: "pass",
		Database: "appdb",
	}
	dsn := s.dsnForRemoteHost(cfg, "sql.internal.example.com")
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse sqlserver ssh dsn: %v", err)
	}
	if got := parsed.Query().Get("hostnameincertificate"); got != "sql.internal.example.com" {
		t.Fatalf("on-prem hostnameincertificate after SSH forward = %q, want sql.internal.example.com", got)
	}
}

func TestSQLServerDSNSSHForwardRespectsExplicitCertificateIdentity(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name             string
		connectionParams string
		wantHostName     string
		wantServerCert   string
	}{
		{
			name:             "hostname in certificate",
			connectionParams: "hostnameincertificate=sql.explicit.example.com",
			wantHostName:     "sql.explicit.example.com",
		},
		{
			name:             "server certificate",
			connectionParams: "servercertificate=C:\\certs\\sqlserver.cer",
			wantServerCert:   `C:\certs\sqlserver.cer`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			s := &SqlServerDB{}
			cfg := connection.ConnectionConfig{
				Host:             "127.0.0.1",
				Port:             58228,
				User:             "sa",
				Password:         "pass",
				Database:         "appdb",
				ConnectionParams: test.connectionParams,
			}
			parsed, err := url.Parse(s.dsnForRemoteHost(cfg, "myserver.database.windows.net"))
			if err != nil {
				t.Fatalf("parse sqlserver ssh dsn with explicit identity: %v", err)
			}
			query := parsed.Query()
			if got := query.Get("hostnameincertificate"); got != test.wantHostName {
				t.Fatalf("hostnameincertificate = %q, want %q", got, test.wantHostName)
			}
			if got := query.Get("servercertificate"); got != test.wantServerCert {
				t.Fatalf("servercertificate = %q, want %q", got, test.wantServerCert)
			}
		})
	}
}

func TestSQLServerDSNExplicitServerCertificateOverridesSSLCAPath(t *testing.T) {
	t.Parallel()

	s := &SqlServerDB{}
	cfg := connection.ConnectionConfig{
		Host:             "127.0.0.1",
		Port:             58228,
		User:             "sa",
		Password:         "pass",
		Database:         "appdb",
		SSLCAPath:        `C:\certs\ca.pem`,
		ConnectionParams: `servercertificate=C:\certs\sqlserver.cer`,
	}
	parsed, err := url.Parse(s.dsnForRemoteHost(cfg, "sql.internal.example.com"))
	if err != nil {
		t.Fatalf("parse sqlserver dsn with conflicting certificates: %v", err)
	}
	query := parsed.Query()
	if got := query.Get("certificate"); got != "" {
		t.Fatalf("certificate = %q, want empty when servercertificate is explicit", got)
	}
	if got := query.Get("servercertificate"); got != `C:\certs\sqlserver.cer` {
		t.Fatalf("servercertificate = %q, want C:\\certs\\sqlserver.cer", got)
	}
}

func TestSQLServerConnectSSHForwardUsesRemoteHostForTLSIdentity(t *testing.T) {
	sqlServerIdentityConnectSeamsMu.Lock()

	originalAcquire := sqlServerAcquireLocalForwarder
	originalOpen := sqlServerOpenDB
	originalRelease := sqlServerReleaseLocalForwarder
	sqlServerReleaseLocalForwarder = func(*ssh.LocalForwarder) error { return nil }
	t.Cleanup(func() {
		sqlServerAcquireLocalForwarder = originalAcquire
		sqlServerOpenDB = originalOpen
		sqlServerReleaseLocalForwarder = originalRelease
		sqlServerIdentityConnectSeamsMu.Unlock()
	})

	forwarder := &ssh.LocalForwarder{LocalAddr: "127.0.0.1:58228"}
	var (
		gotDSN      string
		forwardHost string
		forwardPort int
	)
	sqlServerAcquireLocalForwarder = func(_ connection.SSHConfig, host string, port int) (*ssh.LocalForwarder, error) {
		forwardHost = host
		forwardPort = port
		return forwarder, nil
	}
	sqlServerOpenDB = func(driverName, dsn string) (*sql.DB, error) {
		if driverName != "sqlserver" {
			t.Fatalf("driverName = %q, want sqlserver", driverName)
		}
		gotDSN = dsn
		return openSQLServerIdentityProbeDB(t)
	}

	cfg := connection.ConnectionConfig{
		Type:     "sqlserver",
		Host:     "sql.internal.example.com",
		Port:     1433,
		User:     "sa",
		Password: "pass",
		Database: "appdb",
		UseSSL:   true,
		SSLMode:  "required",
		UseSSH:   true,
		SSH:      connection.SSHConfig{Host: "jump.internal.example.com", Port: 22, User: "jump"},
	}
	s := &SqlServerDB{}
	if err := s.Connect(cfg); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	if forwardHost != "sql.internal.example.com" || forwardPort != 1433 {
		t.Fatalf("SSH forward target = %s:%d, want sql.internal.example.com:1433", forwardHost, forwardPort)
	}
	parsed, err := url.Parse(gotDSN)
	if err != nil {
		t.Fatalf("parse captured sqlserver dsn: %v", err)
	}
	if got := parsed.Host; got != "127.0.0.1:58228" {
		t.Fatalf("dial host = %q, want local forward endpoint", got)
	}
	query := parsed.Query()
	if got := strings.ToLower(query.Get("encrypt")); got != "true" {
		t.Fatalf("encrypt = %q, want true", query.Get("encrypt"))
	}
	if got := strings.ToLower(query.Get("trustservercertificate")); got != "false" {
		t.Fatalf("trustservercertificate = %q, want false", query.Get("trustservercertificate"))
	}
	if got := query.Get("hostnameincertificate"); got != "sql.internal.example.com" {
		t.Fatalf("hostnameincertificate = %q, want sql.internal.example.com", got)
	}
}

func TestSQLServerConnectWithoutSSHKeepsDirectHostIdentity(t *testing.T) {
	sqlServerIdentityConnectSeamsMu.Lock()
	originalOpen := sqlServerOpenDB
	t.Cleanup(func() {
		sqlServerOpenDB = originalOpen
		sqlServerIdentityConnectSeamsMu.Unlock()
	})

	var gotDSN string
	sqlServerOpenDB = func(driverName, dsn string) (*sql.DB, error) {
		if driverName != "sqlserver" {
			t.Fatalf("driverName = %q, want sqlserver", driverName)
		}
		gotDSN = dsn
		return openSQLServerIdentityProbeDB(t)
	}

	cfg := connection.ConnectionConfig{
		Type:     "sqlserver",
		Host:     "sql.internal.example.com",
		Port:     1433,
		User:     "sa",
		Password: "pass",
		Database: "appdb",
		UseSSL:   true,
		SSLMode:  "required",
	}
	s := &SqlServerDB{}
	if err := s.Connect(cfg); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	parsed, err := url.Parse(gotDSN)
	if err != nil {
		t.Fatalf("parse captured direct sqlserver dsn: %v", err)
	}
	if got := parsed.Host; got != "sql.internal.example.com:1433" {
		t.Fatalf("direct dial host = %q, want original host", got)
	}
	if got := parsed.Query().Get("hostnameincertificate"); got != "" {
		t.Fatalf("direct hostnameincertificate = %q, want driver default", got)
	}
}

func TestSQLServerDSNDirectHostKeepsImplicitCertificateDefault(t *testing.T) {
	t.Parallel()

	s := &SqlServerDB{}
	cfg := connection.ConnectionConfig{
		Host:     "sql.internal.example.com",
		Port:     1433,
		User:     "sa",
		Password: "pass",
		Database: "appdb",
	}
	parsed, err := url.Parse(s.getDSN(cfg))
	if err != nil {
		t.Fatalf("parse direct sqlserver dsn: %v", err)
	}
	if got := parsed.Query().Get("hostnameincertificate"); got != "" {
		t.Fatalf("direct hostnameincertificate = %q, want driver default", got)
	}
}
