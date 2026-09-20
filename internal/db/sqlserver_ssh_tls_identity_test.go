//go:build gonavi_full_drivers || gonavi_sqlserver_driver

package db

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"database/sql"
	"database/sql/driver"
	"errors"
	"math/big"
	"net"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/ssh"

	"github.com/microsoft/go-mssqldb/msdsn"
)

const sqlServerIdentityProbeDriverName = "gonavi-sqlserver-identity-probe"

var registerSQLServerIdentityProbeDriver sync.Once

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
			connectionParams: "servercertificate=C:\\certs\\sqlserver.pem",
			wantServerCert:   `C:\certs\sqlserver.pem`,
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

func TestSQLServerDSNWithExplicitServerCertificateParsesWithDriver(t *testing.T) {
	t.Parallel()

	s := &SqlServerDB{}
	cfg := connection.ConnectionConfig{
		Host:             "127.0.0.1",
		Port:             58228,
		User:             "sa",
		Password:         "pass",
		Database:         "appdb",
		SSLCAPath:        `C:\certs\ca.pem`,
		ConnectionParams: `servercertificate=C:\certs\sqlserver.pem&hostnameincertificate=sql.explicit.example.com`,
	}
	dsn := s.dsnForRemoteHost(cfg, "sql.internal.example.com")
	if _, err := msdsn.Parse(dsn); err != nil {
		t.Fatalf("msdsn.Parse(%q) error = %v", dsn, err)
	}
}

func TestSQLServerDSNExplicitServerCertificateOverridesConflictingTLSIdentity(t *testing.T) {
	t.Parallel()

	s := &SqlServerDB{}
	cfg := connection.ConnectionConfig{
		Host:             "127.0.0.1",
		Port:             58228,
		User:             "sa",
		Password:         "pass",
		Database:         "appdb",
		SSLCAPath:        `C:\certs\ca.pem`,
		ConnectionParams: `servercertificate=C:\certs\sqlserver.pem&hostnameincertificate=sql.explicit.example.com`,
	}
	parsed, err := url.Parse(s.dsnForRemoteHost(cfg, "sql.internal.example.com"))
	if err != nil {
		t.Fatalf("parse sqlserver dsn with conflicting certificates: %v", err)
	}
	query := parsed.Query()
	if got := query.Get("certificate"); got != "" {
		t.Fatalf("certificate = %q, want empty when servercertificate is explicit", got)
	}
	if got := query.Get("hostnameincertificate"); got != "" {
		t.Fatalf("hostnameincertificate = %q, want empty when servercertificate is explicit", got)
	}
	if got := query.Get("servercertificate"); got != `C:\certs\sqlserver.pem` {
		t.Fatalf("servercertificate = %q, want C:\\certs\\sqlserver.pem", got)
	}
}

func sqlServerIdentityTestCertificate(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()

	// A deterministic self-signed certificate for the expected remote host is
	// generated once per test run to avoid checking in key material.
	block, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate private key: %v", err)
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "sql.internal.example.com"},
		DNSNames:     []string{"sql.internal.example.com"},
		NotBefore:    now.Add(-time.Hour),
		NotAfter:     now.Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &block.PublicKey, block)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	cert := tls.Certificate{Certificate: [][]byte{der}, PrivateKey: block}
	pool := x509.NewCertPool()
	parsed, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse certificate: %v", err)
	}
	pool.AddCert(parsed)
	return cert, pool
}

func TestSQLServerDSNRemoteIdentityIsUsedForTLSVerification(t *testing.T) {
	cert, pool := sqlServerIdentityTestCertificate(t)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	serverErr := make(chan error, 1)
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			serverErr <- acceptErr
			return
		}
		defer conn.Close()
		tlsConn := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{cert}})
		serverErr <- tlsConn.Handshake()
	}()

	s := &SqlServerDB{}
	cfg := connection.ConnectionConfig{
		Host:     "127.0.0.1",
		Port:     58228,
		Database: "appdb",
	}
	dsn := s.dsnForRemoteHost(cfg, "sql.internal.example.com")
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse dsn: %v", err)
	}
	cfgHost := parsed.Hostname()
	if cfgHost != "127.0.0.1" {
		t.Fatalf("parsed dial host = %q, want 127.0.0.1", cfgHost)
	}
	serverName := parsed.Query().Get("hostnameincertificate")
	if serverName != "sql.internal.example.com" {
		t.Fatalf("hostnameincertificate = %q, want sql.internal.example.com", serverName)
	}

	clientConn, err := tls.Dial("tcp", listener.Addr().String(), &tls.Config{
		ServerName: serverName,
		RootCAs:    pool,
	})
	if err != nil {
		t.Fatalf("TLS dial with remote identity: %v", err)
	}
	_ = clientConn.Close()
	if err := <-serverErr; err != nil && !errors.Is(err, tls.AlertError(0)) && !strings.Contains(err.Error(), "use of closed network connection") {
		t.Fatalf("server handshake: %v", err)
	}
}

func TestSQLServerConnectSSHForwardUsesRemoteHostForTLSIdentity(t *testing.T) {
	forwarder := &ssh.LocalForwarder{LocalAddr: "127.0.0.1:58228"}
	var (
		gotDSN      string
		forwardHost string
		forwardPort int
	)
	s := &SqlServerDB{}
	s.acquireLocalForwarder = func(_ connection.SSHConfig, host string, port int) (*ssh.LocalForwarder, error) {
		forwardHost = host
		forwardPort = port
		return forwarder, nil
	}
	s.openDB = func(driverName, dsn string) (*sql.DB, error) {
		if driverName != "sqlserver" {
			t.Fatalf("driverName = %q, want sqlserver", driverName)
		}
		gotDSN = dsn
		return openSQLServerIdentityProbeDB(t)
	}
	s.releaseLocalForwarder = func(*ssh.LocalForwarder) error { return nil }

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

func TestSQLServerConnectSSHAzureUsesRemoteIdentityAndRequiredTLS(t *testing.T) {
	forwarder := &ssh.LocalForwarder{LocalAddr: "127.0.0.1:58229"}
	var gotDSN string
	s := &SqlServerDB{}
	s.acquireLocalForwarder = func(_ connection.SSHConfig, _ string, _ int) (*ssh.LocalForwarder, error) {
		return forwarder, nil
	}
	s.openDB = func(driverName, dsn string) (*sql.DB, error) {
		if driverName != "sqlserver" {
			t.Fatalf("driverName = %q, want sqlserver", driverName)
		}
		gotDSN = dsn
		return openSQLServerIdentityProbeDB(t)
	}
	s.releaseLocalForwarder = func(*ssh.LocalForwarder) error { return nil }

	cfg := connection.ConnectionConfig{
		Type:     "sqlserver",
		Host:     "myserver.database.windows.net",
		Port:     1433,
		User:     "sa",
		Password: "pass",
		Database: "appdb",
		UseSSL:   true,
		SSLMode:  "required",
		UseSSH:   true,
		SSH:      connection.SSHConfig{Host: "jump.internal.example.com", Port: 22, User: "jump"},
	}
	if err := s.Connect(cfg); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	parsed, err := url.Parse(gotDSN)
	if err != nil {
		t.Fatalf("parse captured azure sqlserver dsn: %v", err)
	}
	if got := parsed.Host; got != "127.0.0.1:58229" {
		t.Fatalf("dial host = %q, want local forward endpoint", got)
	}
	query := parsed.Query()
	if got := strings.ToLower(query.Get("encrypt")); got != "true" {
		t.Fatalf("encrypt = %q, want true", query.Get("encrypt"))
	}
	if got := strings.ToLower(query.Get("trustservercertificate")); got != "false" {
		t.Fatalf("trustservercertificate = %q, want false", query.Get("trustservercertificate"))
	}
	if got := query.Get("hostnameincertificate"); got != "*.database.windows.net" {
		t.Fatalf("hostnameincertificate = %q, want *.database.windows.net", got)
	}
}

func TestSQLServerConnectSSHReleasesForwarderOnFailure(t *testing.T) {
	tests := []struct {
		name        string
		localAddr   string
		openErr     error
		wantRelease int
	}{
		{name: "invalid local address", localAddr: "not-a-host:port", wantRelease: 1},
		{name: "open failure", localAddr: "127.0.0.1:58230", openErr: errors.New("open failed"), wantRelease: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			forwarder := &ssh.LocalForwarder{LocalAddr: test.localAddr}
			releaseCount := 0
			s := &SqlServerDB{}
			s.acquireLocalForwarder = func(_ connection.SSHConfig, _ string, _ int) (*ssh.LocalForwarder, error) {
				return forwarder, nil
			}
			s.openDB = func(string, string) (*sql.DB, error) {
				if test.openErr != nil {
					return nil, test.openErr
				}
				return openSQLServerIdentityProbeDB(t)
			}
			s.releaseLocalForwarder = func(*ssh.LocalForwarder) error {
				releaseCount++
				return nil
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
			if err := s.Connect(cfg); err == nil {
				t.Fatal("Connect() error = nil, want failure")
			}
			if releaseCount != test.wantRelease {
				t.Fatalf("Release() calls = %d, want %d", releaseCount, test.wantRelease)
			}
			if s.forwarder != nil {
				t.Fatalf("s.forwarder = %#v, want nil after failed Connect", s.forwarder)
			}
		})
	}
}
func TestSQLServerConnectWithoutSSHKeepsDirectHostIdentity(t *testing.T) {
	var gotDSN string
	s := &SqlServerDB{}
	s.openDB = func(driverName, dsn string) (*sql.DB, error) {
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
