package xxljob

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"strings"
	"time"

	"GoNavi-Wails/internal/connection"
	proxytunnel "GoNavi-Wails/internal/proxy"
	"GoNavi-Wails/internal/tlsconfig"
)

// proxyDialContext is a seam so tests can assert the proxy branch.
var proxyDialContext = proxytunnel.DialContext

// resolveContextPath reads contextPath from connectionParams. Unlike Nacos the
// XXL-JOB default is the root path, and 3.4.1 removed the setting entirely, so
// an absent value must stay "/".
func resolveContextPath(config connection.ConnectionConfig) string {
	for _, pair := range strings.Split(config.ConnectionParams, "&") {
		key, value, found := strings.Cut(pair, "=")
		if !found || !strings.EqualFold(strings.TrimSpace(key), "contextPath") {
			continue
		}
		decoded := value
		if unescaped, err := url.QueryUnescape(value); err == nil {
			decoded = unescaped
		}
		return normalizeContextPath(decoded)
	}
	if strings.Contains(config.Database, "/") {
		return normalizeContextPath(config.Database)
	}
	return ""
}

// normalizeContextPath yields a "" or "/prefix" form suitable for url.Path.
func normalizeContextPath(raw string) string {
	path := strings.TrimSpace(raw)
	if path == "" || path == "/" {
		return ""
	}
	// Collapse the surrounding slashes so an admin mounted under "//admin//"
	// still produces a single clean prefix.
	segments := make([]string, 0, 4)
	for _, segment := range strings.Split(path, "/") {
		if segment != "" {
			segments = append(segments, segment)
		}
	}
	if len(segments) == 0 {
		return ""
	}
	return "/" + strings.Join(segments, "/")
}

func buildXxlJobHTTPClient(
	config connection.ConnectionConfig,
	dialAddress string,
) (*http.Client, *url.URL, *cookiejar.Jar, error) {
	scheme := "http"
	if config.UseSSL || isTLSMode(config.SSLMode) {
		scheme = "https"
	}
	base, err := url.Parse(fmt.Sprintf("%s://%s", scheme, net.JoinHostPort(config.Host, strconv.Itoa(config.Port))))
	if err != nil {
		return nil, nil, nil, localizedXxlJobErrorWithCause("xxljob.backend.error.invalid_address", nil, err)
	}
	base.Path = resolveContextPath(config)

	transport, err := buildXxlJobTransport(config, scheme, dialAddress)
	if err != nil {
		return nil, nil, nil, err
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, nil, nil, localizedXxlJobErrorWithCause("xxljob.backend.error.cookie_jar_failed", nil, err)
	}

	client := &http.Client{
		// Redirects are suppressed so the 2.x expired-session redirect stays
		// visible instead of silently landing on the login HTML page.
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
		// Per-request deadlines come from the caller's context; caching the
		// first request's timeout would leak into later operations.
		Timeout:   0,
		Transport: transport,
		// Cookies are held only in this jar for the connection's lifetime.
		Jar: jar,
	}
	return client, base, jar, nil
}

func isTLSMode(mode string) bool {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "required", "preferred", "verify-ca", "verify-full":
		return true
	default:
		return false
	}
}

func buildXxlJobTransport(
	config connection.ConnectionConfig,
	scheme string,
	dialAddress string,
) (*http.Transport, error) {
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	dialContext := dialer.DialContext
	explicitHop := false
	if target := strings.TrimSpace(dialAddress); target != "" {
		explicitHop = true
		dialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, target)
		}
	} else if config.UseProxy {
		explicitHop = true
		proxyConfig := config.Proxy
		dialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			return dialProxyContext(ctx, proxyConfig, network, address)
		}
	}

	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           dialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          32,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	if explicitHop {
		// DialContext already performs the explicit hop; an environment proxy
		// on top of it would double-proxy.
		transport.Proxy = nil
	}

	if scheme != "https" {
		return transport, nil
	}
	sslMode := strings.ToLower(strings.TrimSpace(config.SSLMode))
	insecure := sslMode == "skip-verify" || sslMode == "preferred" || sslMode == ""
	tlsCfg, err := tlsconfig.BuildClientConfig(tlsconfig.ClientConfigOptions{
		Enabled:            true,
		InsecureSkipVerify: insecure,
		CAPath:             config.SSLCAPath,
		CertPath:           config.SSLCertPath,
		KeyPath:            config.SSLKeyPath,
	})
	if err != nil {
		return nil, localizedXxlJobErrorWithCause("xxljob.backend.error.tls_setup_failed", nil, err)
	}
	if tlsCfg == nil {
		tlsCfg = &tls.Config{
			MinVersion:         tls.VersionTLS12,
			InsecureSkipVerify: insecure, //nolint:gosec // mirrors the configured sslMode
		}
	}
	if explicitHop {
		tlsCfg.ServerName = strings.Trim(strings.TrimSpace(config.Host), "[]")
	}
	transport.TLSClientConfig = tlsCfg
	return transport, nil
}
