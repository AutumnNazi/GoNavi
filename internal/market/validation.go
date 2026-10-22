package market

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/mod/semver"
)

var pluginIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}[.][a-z][a-z0-9.-]{0,127}$`)
var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var platformPattern = regexp.MustCompile(`^[a-z0-9]+/[a-z0-9]+$`)
var userCodePattern = regexp.MustCompile(`^[A-F0-9]{5}-[A-F0-9]{5}$`)

func validPluginID(id string) bool {
	return pluginIDPattern.MatchString(id) && !strings.Contains(id, "..") && !strings.HasSuffix(id, ".")
}
func validVersion(version string) bool {
	return len(version) <= 100 && semver.IsValid("v"+version) && strings.Count(strings.SplitN(strings.SplitN(version, "+", 2)[0], "-", 2)[0], ".") == 2
}

func validateCatalogQuery(q CatalogQuery) error {
	if q.Limit < 1 || q.Limit > 100 || q.Offset < 0 || q.Offset > 10000 || !boundedText(q.Query, 200, false) {
		return ErrInvalid
	}
	if q.Sort != "" && q.Sort != "updated" && q.Sort != "rating" && q.Sort != "downloads" {
		return ErrInvalid
	}
	if q.HostVersion != "" && !validVersion(q.HostVersion) {
		return ErrInvalid
	}
	if q.Platform != "" && q.Platform != "any" && !platformPattern.MatchString(q.Platform) {
		return ErrInvalid
	}
	return nil
}

func parseCatalogQuery(v url.Values) (CatalogQuery, error) {
	q := CatalogQuery{Query: strings.TrimSpace(v.Get("q")), Sort: v.Get("sort"), HostVersion: strings.TrimPrefix(v.Get("hostVersion"), "v"), Platform: v.Get("platform"), Limit: 24}
	var err error
	if raw := v.Get("limit"); raw != "" {
		q.Limit, err = strconv.Atoi(raw)
		if err != nil {
			return q, ErrInvalid
		}
	}
	if raw := v.Get("cursor"); raw != "" {
		decoded, decodeErr := base64.RawURLEncoding.DecodeString(raw)
		if decodeErr != nil {
			return q, ErrInvalid
		}
		q.Offset, err = strconv.Atoi(string(decoded))
		if err != nil {
			return q, ErrInvalid
		}
	}
	return q, validateCatalogQuery(q)
}

func boundedText(value string, limit int, required bool) bool {
	return len(value) <= limit && utf8.ValidString(value) && !strings.ContainsRune(value, 0) && (!required || strings.TrimSpace(value) != "")
}

func newSecret(bytes int) (string, error) {
	value := make([]byte, bytes)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate secure identifier: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func secretHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func validatePublicURL(raw string) (string, bool, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", false, ErrInvalid
	}
	local := u.Hostname() == "localhost"
	if ip := net.ParseIP(u.Hostname()); ip != nil {
		local = ip.IsLoopback()
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return "", false, ErrInvalid
	}
	return strings.TrimRight(u.String(), "/"), u.Scheme == "https", nil
}
