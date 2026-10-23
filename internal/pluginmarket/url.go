package pluginmarket

import (
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/netip"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
)

var (
	idPattern      = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*([.][a-z0-9][a-z0-9-]*)+$`)
	versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?([+][0-9A-Za-z.-]+)?$`)
	digestPattern  = regexp.MustCompile(`^[a-f0-9]{64}$`)
	codePattern    = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
)

func normalizeBase(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	u, err := parseSafeURL(raw)
	if err != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" {
		return "", ErrInvalidURL
	}
	prefix := strings.TrimRight(u.Path, "/")
	prefix = strings.TrimSuffix(prefix, "/api/v1")
	if prefix != "" && (path.Clean(prefix) != prefix || strings.Contains(prefix, "\\")) {
		return "", ErrInvalidURL
	}
	u.Path = prefix
	return u.String(), nil
}

func parseSafeURL(raw string) (*url.URL, error) {
	if len(raw) > 2048 {
		return nil, ErrInvalidURL
	}
	u, err := url.Parse(raw)
	if err != nil || u.Opaque != "" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return nil, ErrInvalidURL
	}
	u.Scheme = strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	if host == "" || strings.ContainsAny(host, "%\\") {
		return nil, ErrInvalidURL
	}
	if u.Scheme != "https" && (u.Scheme != "http" || !loopbackHost(host)) {
		return nil, ErrInvalidURL
	}
	port := u.Port()
	if port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 1 || number > 65535 {
			return nil, ErrInvalidURL
		}
		port = strconv.Itoa(number)
	}
	if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		port = ""
	}
	if port != "" {
		u.Host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		u.Host = "[" + host + "]"
	} else {
		u.Host = host
	}
	return u, nil
}

func loopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip, err := netip.ParseAddr(host)
	return err == nil && ip.Unmap().IsLoopback()
}

func sourceID(base string) string {
	if base == "" {
		return ""
	}
	digest := sha256.Sum256([]byte(base))
	return hex.EncodeToString(digest[:])
}

func sameOrigin(base, target string) (string, error) {
	b, err := parseSafeURL(base)
	if err != nil {
		return "", err
	}
	ref, err := url.Parse(target)
	if err != nil {
		return "", ErrInvalidURL
	}
	u, err := parseSafeURL(b.ResolveReference(ref).String())
	if err != nil || u.Scheme != b.Scheme || u.Host != b.Host {
		return "", ErrInvalidURL
	}
	return u.String(), nil
}

func validID(id string) bool { return len(id) <= 200 && idPattern.MatchString(id) }
func validVersion(version string) bool {
	return len(version) <= 128 && versionPattern.MatchString(version)
}
