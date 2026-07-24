package app

import (
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"GoNavi-Wails/internal/connection"
)

const customClickHouseDSNMaxLength = 4096

type customClickHouseEndpoint struct {
	host             string
	port             int
	user             string
	password         string
	database         string
	connectionParams string
	protocol         string
	useSSL           bool
	sslMode          string
	sslCAPath        string
	sslCertPath      string
	sslKeyPath       string
}

func (a *App) resolveCustomClickHouseRuntimeConfig(config connection.ConnectionConfig) (connection.ConnectionConfig, error) {
	if !strings.EqualFold(strings.TrimSpace(config.Type), "custom") ||
		!strings.EqualFold(strings.TrimSpace(config.Driver), "clickhouse") {
		return config, nil
	}

	dsn := strings.TrimSpace(config.DSN)
	if dsn == "" {
		return config, fmt.Errorf("%s", a.appText("db.backend.error.custom_clickhouse_dsn_required", nil))
	}
	endpoint, ok := parseCustomClickHouseEndpoint(dsn)
	if !ok {
		return config, fmt.Errorf("%s", a.appText("db.backend.error.custom_clickhouse_dsn_invalid", nil))
	}
	if config.HasRuntimeDatabaseOverride() {
		endpoint.database = strings.TrimSpace(config.RuntimeDatabaseOverride())
	}

	runtimeConfig := config
	runtimeConfig.Type = "clickhouse"
	runtimeConfig.Driver = ""
	runtimeConfig.DSN = ""
	runtimeConfig.URI = ""
	runtimeConfig.Host = endpoint.host
	runtimeConfig.Port = endpoint.port
	runtimeConfig.User = endpoint.user
	runtimeConfig.Password = endpoint.password
	runtimeConfig.Database = endpoint.database
	runtimeConfig.ConnectionParams = endpoint.connectionParams
	runtimeConfig.ClickHouseProtocol = endpoint.protocol
	runtimeConfig.UseSSL = endpoint.useSSL
	runtimeConfig.SSLMode = endpoint.sslMode
	runtimeConfig.SSLCAPath = endpoint.sslCAPath
	runtimeConfig.SSLCertPath = endpoint.sslCertPath
	runtimeConfig.SSLKeyPath = endpoint.sslKeyPath
	runtimeConfig.Hosts = nil
	runtimeConfig.Topology = ""
	runtimeConfig.OceanBaseProtocol = ""
	runtimeConfig.RedisDB = 0
	runtimeConfig.RedisSentinelMaster = ""
	runtimeConfig.RedisSentinelUser = ""
	runtimeConfig.RedisSentinelPassword = ""
	runtimeConfig.MySQLReplicaUser = ""
	runtimeConfig.MySQLReplicaPassword = ""
	runtimeConfig.ReplicaSet = ""
	runtimeConfig.AuthSource = ""
	runtimeConfig.ReadPreference = ""
	runtimeConfig.MongoSRV = false
	runtimeConfig.MongoAuthMechanism = ""
	runtimeConfig.MongoReplicaUser = ""
	runtimeConfig.MongoReplicaPassword = ""
	runtimeConfig.JVM = connection.JVMConfig{}
	runtimeConfig = runtimeConfig.WithoutRuntimeDatabaseOverride()
	return runtimeConfig, nil
}

func parseCustomClickHouseEndpoint(rawDSN string) (customClickHouseEndpoint, bool) {
	dsn := strings.TrimSpace(rawDSN)
	if dsn == "" || len(dsn) > customClickHouseDSNMaxLength || containsControlCharacter(dsn) {
		return customClickHouseEndpoint{}, false
	}

	endpointText, jdbc, ok := normalizeCustomClickHouseEndpointText(dsn)
	if !ok {
		return customClickHouseEndpoint{}, false
	}
	parsed, err := url.Parse(endpointText)
	if err != nil || parsed == nil || parsed.Opaque != "" || parsed.Fragment != "" {
		return customClickHouseEndpoint{}, false
	}

	scheme := strings.ToLower(strings.TrimSpace(parsed.Scheme))
	if scheme != "clickhouse" && scheme != "http" && scheme != "https" {
		return customClickHouseEndpoint{}, false
	}
	if jdbc && scheme != "http" && scheme != "https" {
		return customClickHouseEndpoint{}, false
	}
	if strings.TrimSpace(parsed.Host) == "" || strings.ContainsAny(parsed.Host, ",;") || strings.HasSuffix(parsed.Host, ":") {
		return customClickHouseEndpoint{}, false
	}

	host := strings.TrimSpace(parsed.Hostname())
	if host == "" || containsControlCharacter(host) || strings.Contains(host, ":") && !strings.HasPrefix(parsed.Host, "[") {
		return customClickHouseEndpoint{}, false
	}

	explicitPort := false
	port := 0
	if portText := strings.TrimSpace(parsed.Port()); portText != "" {
		parsedPort, convErr := strconv.Atoi(portText)
		if convErr != nil || parsedPort <= 0 || parsedPort > 65535 {
			return customClickHouseEndpoint{}, false
		}
		port = parsedPort
		explicitPort = true
	}

	query, err := url.ParseQuery(parsed.RawQuery)
	if err != nil || connectionValuesContainControlCharacter(query) {
		return customClickHouseEndpoint{}, false
	}

	user := ""
	password := ""
	if parsed.User != nil {
		user = parsed.User.Username()
		if parsedPassword, hasPassword := parsed.User.Password(); hasPassword {
			password = parsedPassword
		}
	}
	if containsControlCharacter(user) || containsControlCharacter(password) {
		return customClickHouseEndpoint{}, false
	}

	queryUser, hasQueryUser := popConnectionValue(query, "user")
	queryUsername, hasQueryUsername := popConnectionValue(query, "username")
	if hasQueryUser {
		user = queryUser
	} else if hasQueryUsername {
		user = queryUsername
	}
	if queryPassword, exists := popConnectionValue(query, "password"); exists {
		password = queryPassword
	}

	database := strings.Trim(strings.TrimSpace(parsed.Path), "/")
	if database != "" && strings.Contains(database, "/") {
		return customClickHouseEndpoint{}, false
	}
	if queryDatabase, exists := popConnectionValue(query, "database"); exists {
		database = strings.TrimSpace(queryDatabase)
	}
	if containsControlCharacter(user) || containsControlCharacter(password) || containsControlCharacter(database) {
		return customClickHouseEndpoint{}, false
	}

	protocolValue, hasProtocol := popConnectionValue(query, "protocol")
	protocol, protocolTLS, protocolOK := resolveCustomClickHouseProtocol(scheme, jdbc, protocolValue, hasProtocol, port, explicitPort)
	if !protocolOK {
		return customClickHouseEndpoint{}, false
	}

	secureProtocol := scheme == "https" || protocolTLS
	useSSL := secureProtocol
	sslMode := ""
	if useSSL {
		sslMode = "required"
	}
	for _, key := range []string{"ssl", "secure"} {
		if rawValue, exists := popConnectionValue(query, key); exists {
			enabled, known := parseCustomClickHouseBool(rawValue)
			if !known {
				return customClickHouseEndpoint{}, false
			}
			useSSL = enabled
			if enabled {
				sslMode = "required"
			} else {
				sslMode = ""
			}
		}
	}
	if rawMode, exists := popConnectionValue(query, "sslmode"); exists {
		var modeOK bool
		useSSL, sslMode, modeOK = normalizeCustomClickHouseSSLMode(rawMode)
		if !modeOK {
			return customClickHouseEndpoint{}, false
		}
	}
	if rawSkipVerify, exists := popConnectionValue(query, "skip_verify"); exists {
		skipVerify, known := parseCustomClickHouseBool(rawSkipVerify)
		if !known {
			return customClickHouseEndpoint{}, false
		}
		if skipVerify {
			useSSL = true
			sslMode = "skip-verify"
		}
	}
	if secureProtocol {
		useSSL = true
		if sslMode == "" {
			sslMode = "required"
		}
	}
	if !useSSL {
		sslMode = ""
	}

	sslCAPath := popFirstConnectionValue(query, "sslrootcert", "ssl_ca", "ca_cert")
	sslCertPath := popFirstConnectionValue(query, "sslcert", "ssl_cert", "client_cert")
	sslKeyPath := popFirstConnectionValue(query, "sslkey", "ssl_key", "client_key")
	if containsControlCharacter(sslCAPath) || containsControlCharacter(sslCertPath) || containsControlCharacter(sslKeyPath) {
		return customClickHouseEndpoint{}, false
	}

	if !explicitPort {
		switch {
		case protocol == "http" && useSSL:
			port = 8443
		case protocol == "http":
			port = 8123
		default:
			port = 9000
		}
	}

	return customClickHouseEndpoint{
		host:             host,
		port:             port,
		user:             user,
		password:         password,
		database:         database,
		connectionParams: query.Encode(),
		protocol:         protocol,
		useSSL:           useSSL,
		sslMode:          sslMode,
		sslCAPath:        strings.TrimSpace(sslCAPath),
		sslCertPath:      strings.TrimSpace(sslCertPath),
		sslKeyPath:       strings.TrimSpace(sslKeyPath),
	}, true
}

func normalizeCustomClickHouseEndpointText(dsn string) (string, bool, bool) {
	for _, prefix := range []string{"jdbc:clickhouse:", "jdbc:ch:"} {
		if len(dsn) >= len(prefix) && strings.EqualFold(dsn[:len(prefix)], prefix) {
			remainder := strings.TrimSpace(dsn[len(prefix):])
			switch {
			case strings.HasPrefix(remainder, "//"):
				return "http:" + remainder, true, true
			case hasEndpointScheme(remainder, "http"), hasEndpointScheme(remainder, "https"):
				return remainder, true, true
			default:
				return "", true, false
			}
		}
	}
	if strings.HasPrefix(strings.ToLower(dsn), "jdbc:") {
		return "", false, false
	}
	for _, scheme := range []string{"clickhouse", "http", "https"} {
		if hasEndpointScheme(dsn, scheme) {
			return dsn, false, true
		}
	}
	return "", false, false
}

func hasEndpointScheme(value string, scheme string) bool {
	prefix := scheme + "://"
	return len(value) >= len(prefix) && strings.EqualFold(value[:len(prefix)], prefix)
}

func resolveCustomClickHouseProtocol(scheme string, jdbc bool, rawProtocol string, hasProtocol bool, port int, explicitPort bool) (string, bool, bool) {
	normalizedProtocol := strings.ToLower(strings.TrimSpace(rawProtocol))
	if jdbc || scheme == "http" || scheme == "https" {
		if hasProtocol && normalizedProtocol != "" && normalizedProtocol != "http" && normalizedProtocol != "https" {
			return "", false, false
		}
		return "http", scheme == "https" || normalizedProtocol == "https", true
	}
	if hasProtocol {
		switch normalizedProtocol {
		case "", "auto":
			return "", false, true
		case "http":
			return "http", false, true
		case "https":
			return "http", true, true
		case "native", "tcp":
			return "native", false, true
		default:
			return "", false, false
		}
	}
	if explicitPort && isCustomClickHouseHTTPPort(port) {
		return "http", false, true
	}
	return "", false, true
}

func isCustomClickHouseHTTPPort(port int) bool {
	switch port {
	case 8123, 8125, 8132, 8443:
		return true
	default:
		return false
	}
}

func popConnectionValue(values url.Values, target string) (string, bool) {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	value := ""
	found := false
	for _, key := range keys {
		if !strings.EqualFold(strings.TrimSpace(key), target) {
			continue
		}
		items := values[key]
		if len(items) > 0 {
			value = items[len(items)-1]
		}
		delete(values, key)
		found = true
	}
	return value, found
}

func popFirstConnectionValue(values url.Values, targets ...string) string {
	selected := ""
	hasSelected := false
	for _, target := range targets {
		value, exists := popConnectionValue(values, target)
		if exists && !hasSelected {
			selected = value
			hasSelected = true
		}
	}
	return selected
}

func parseCustomClickHouseBool(raw string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on", "enabled":
		return true, true
	case "0", "false", "no", "off", "disabled":
		return false, true
	default:
		return false, false
	}
}

func normalizeCustomClickHouseSSLMode(raw string) (bool, string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "strict", "required", "require", "verify-ca", "verify-full", "on", "true":
		return true, "required", true
	case "skip-verify", "skip_verify", "insecure", "insecure-skip-verify":
		return true, "skip-verify", true
	case "preferred", "prefer", "allow":
		return true, "preferred", true
	case "disable", "disabled", "none", "off", "false":
		return false, "", true
	default:
		return false, "", false
	}
}

func connectionValuesContainControlCharacter(values url.Values) bool {
	for key, items := range values {
		if containsControlCharacter(key) {
			return true
		}
		for _, item := range items {
			if containsControlCharacter(item) {
				return true
			}
		}
	}
	return false
}

func containsControlCharacter(value string) bool {
	return strings.IndexFunc(value, unicode.IsControl) >= 0
}
