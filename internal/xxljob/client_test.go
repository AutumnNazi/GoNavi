package xxljob

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestResolveContextPath(t *testing.T) {
	cases := []struct {
		name     string
		params   string
		database string
		want     string
	}{
		{name: "absent defaults to root", want: ""},
		{name: "explicit root", params: "contextPath=/", want: ""},
		{name: "named prefix", params: "contextPath=%2Fxxl-job-admin", want: "/xxl-job-admin"},
		{name: "plain value", params: "contextPath=/xxl-job-admin", want: "/xxl-job-admin"},
		{name: "trailing slash trimmed", params: "contextPath=%2Fxxl-job-admin%2F", want: "/xxl-job-admin"},
		{name: "leading slash added", params: "contextPath=admin", want: "/admin"},
		{name: "among other params", params: "a=1&contextPath=%2Fadmin&b=2", want: "/admin"},
		{name: "case insensitive key", params: "ContextPath=%2Fadmin", want: "/admin"},
		{name: "falls back to database", database: "/xxl-job-admin", want: "/xxl-job-admin"},
		{name: "params win over database", params: "contextPath=%2Fa", database: "/b", want: "/a"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			config := connection.ConnectionConfig{ConnectionParams: tc.params, Database: tc.database}
			if got := resolveContextPath(config); got != tc.want {
				t.Errorf("resolveContextPath = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestNormalizeContextPath(t *testing.T) {
	cases := map[string]string{
		"":           "",
		"/":          "",
		"  /  ":      "",
		"admin":      "/admin",
		"/admin/":    "/admin",
		"/a/b/":      "/a/b",
		"///deep///": "/deep",
	}
	for input, want := range cases {
		if got := normalizeContextPath(input); got != want {
			t.Errorf("normalizeContextPath(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestIsTLSMode(t *testing.T) {
	for mode, want := range map[string]bool{
		"required":    true,
		"preferred":   true,
		"verify-ca":   true,
		"verify-full": true,
		"skip-verify": false,
		"":            false,
	} {
		if got := isTLSMode(mode); got != want {
			t.Errorf("isTLSMode(%q) = %v, want %v", mode, got, want)
		}
	}
}

func TestTransportDropsEnvironmentProxyOnExplicitHop(t *testing.T) {
	base := connection.ConnectionConfig{Host: "example.test", Port: 8080}

	direct, err := buildXxlJobTransport(base, "http", "")
	if err != nil {
		t.Fatalf("direct transport: %v", err)
	}
	if direct.Proxy == nil {
		t.Error("a direct hop should keep the environment proxy")
	}

	tunneled, err := buildXxlJobTransport(base, "http", "127.0.0.1:10022")
	if err != nil {
		t.Fatalf("tunneled transport: %v", err)
	}
	if tunneled.Proxy != nil {
		t.Error("an SSH hop is already the explicit route; an environment proxy would double-proxy it")
	}
}

func TestConnectOverInjectedSSHForwarder(t *testing.T) {
	admin := newFakeAdmin(t, flavor2x, "")
	host, port := admin.hostPort()

	lease := &fakeLease{address: host + ":" + itoa(port)}
	client := NewClient()
	client.acquire = func(connection.SSHConfig, string, int) (forwarderLease, error) {
		return lease, nil
	}

	ctx, cancel := testContext(t)
	defer cancel()
	config := admin.testConfig(t)
	config.UseSSH = true

	if _, err := client.Connect(ctx, config); err != nil {
		t.Fatalf("connect through a forwarder: %v", err)
	}
	_ = client.Close()
	if !lease.released {
		t.Error("Close must release the SSH forwarder")
	}
}

func TestConnectFailsWhenForwarderAddressIsEmpty(t *testing.T) {
	client := NewClient()
	client.acquire = func(connection.SSHConfig, string, int) (forwarderLease, error) {
		return &fakeLease{}, nil
	}
	ctx, cancel := testContext(t)
	defer cancel()
	config := connection.ConnectionConfig{Type: "xxljob", Host: "127.0.0.1", Port: 1, UseSSH: true}
	if _, err := client.Connect(ctx, config); err == nil {
		t.Fatal("expected an empty forward address to fail the connect")
	}
}

func TestConnectRequiresHost(t *testing.T) {
	client := NewClient()
	ctx, cancel := testContext(t)
	defer cancel()
	_, err := client.Connect(ctx, connection.ConnectionConfig{Type: "xxljob"})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("error = %v, want ErrValidation", err)
	}
}

func TestCloseIsIdempotent(t *testing.T) {
	client := NewClient()
	if err := client.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}
	if err := client.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
}

func TestRedactDiagnosticTextDropsSecrets(t *testing.T) {
	cases := []struct {
		name      string
		input     string
		forbidden string
	}{
		{"password assignment", "failed with password=123456", "123456"},
		{"2.x identity cookie", "cookie XXL_JOB_LOGIN_IDENTITY=abc123def456", "abc123def456"},
		{"sso token cookie", "set xxl_job_login_token=zzz999", "zzz999"},
		{"session cookie", "JSESSIONID=deadbeefcafe", "deadbeefcafe"},
		{"json access token", `{"accessToken":"tok-123"}`, "tok-123"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := redactDiagnosticText(tc.input)
			if strings.Contains(got, tc.forbidden) {
				t.Errorf("redactDiagnosticText(%q) = %q, still contains %q", tc.input, got, tc.forbidden)
			}
		})
	}
}

func TestTruncateDiagnosticCapsLength(t *testing.T) {
	long := strings.Repeat("x", maxDiagnosticTextRunes*2)
	got := truncateDiagnostic(long)
	if len([]rune(got)) != maxDiagnosticTextRunes+3 {
		t.Errorf("length = %d runes, want %d", len([]rune(got)), maxDiagnosticTextRunes+3)
	}
}

func TestSessionExpiredFromRedirectIgnoresQueryString(t *testing.T) {
	for _, location := range []string{
		"/toLogin",
		"/xxl-job-admin/toLogin",
		"http://admin.example.test/xxl-job-admin/toLogin",
		"/xxl-job-admin/toLogin?redirect=%2Fjobinfo",
	} {
		if !sessionExpiredFromRedirect(location) {
			t.Errorf("sessionExpiredFromRedirect(%q) = false, want true", location)
		}
	}
	if sessionExpiredFromRedirect("/jobinfo") {
		t.Error("an unrelated redirect must not read as an expired session")
	}
}

func TestSessionExpiredFromEnvelopeSeparatesBusinessErrors(t *testing.T) {
	expired := []string{
		"xxl-job login expired, please login again",
		"XxlSsoException: no login",
		"invalid login token",
		"unauthorized",
		"未登录",
	}
	for _, msg := range expired {
		if !sessionExpiredFromEnvelope(http.StatusInternalServerError, msg) {
			t.Errorf("sessionExpiredFromEnvelope(500, %q) = false, want true", msg)
		}
	}
	business := []string{"job group not found", "executor address is empty", "task already running"}
	for _, msg := range business {
		if sessionExpiredFromEnvelope(http.StatusInternalServerError, msg) {
			t.Errorf("sessionExpiredFromEnvelope(500, %q) = true, want false", msg)
		}
	}
	// A non-500 code is never a session problem regardless of wording.
	if sessionExpiredFromEnvelope(http.StatusBadRequest, "not login") {
		t.Error("a 400 must not be reported as an expired session")
	}
}

type fakeLease struct {
	address  string
	released bool
}

func (l *fakeLease) LocalAddress() string { return l.address }

func (l *fakeLease) Release() error {
	l.released = true
	return nil
}
