//go:build gonavi_full_drivers || gonavi_hive_driver

package db

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/connection"
	proxytunnel "GoNavi-Wails/internal/proxy"
	"GoNavi-Wails/internal/ssh"
)

const (
	defaultHivePort     = 10000
	defaultHiveDatabase = "default"
	defaultHiveUser     = "hive"
)

var hiveVersionPattern = regexp.MustCompile(`(\d+\.\d+(?:\.\d+)?)`)

// HiveDB 通过 HiveServer2 TCLIService Thrift Binary 协议访问 Apache Hive（3.x / 4.x）。
type HiveDB struct {
	driverVariantState
	transport   *hiveTransport
	sessionID   hiveHandleID
	serverProto int32
	database    string
	currentDB   string
	forwarder   *ssh.LocalForwarder
	timeout     time.Duration
	execMu      sync.Mutex
}

var (
	_ Database              = (*HiveDB)(nil)
	_ QueryContexter        = (*HiveDB)(nil)
	_ ExecContexter         = (*HiveDB)(nil)
	_ StreamQueryExecer     = (*HiveDB)(nil)
	_ QueryArgsContexter    = (*HiveDB)(nil)
	_ ExecArgsContexter     = (*HiveDB)(nil)
	_ BatchApplierContext   = (*HiveDB)(nil)
	_ DriverVariantReporter = (*HiveDB)(nil)
)

type hiveResolvedTarget struct {
	host     string
	port     int
	user     string
	password string
	database string
	useSSL   bool
	params   url.Values
}

func resolveHiveTarget(config connection.ConnectionConfig) hiveResolvedTarget {
	target := hiveResolvedTarget{
		host:     strings.TrimSpace(config.Host),
		port:     config.Port,
		user:     strings.TrimSpace(config.User),
		password: config.Password,
		database: strings.TrimSpace(config.Database),
		useSSL:   config.UseSSL,
		params:   parseHiveConnectionParams(config.ConnectionParams),
	}
	if uri := strings.TrimSpace(config.URI); uri != "" {
		applyHiveURI(&target, uri)
	}
	if target.host == "" {
		target.host = "127.0.0.1"
	}
	if target.port <= 0 {
		target.port = defaultHivePort
	}
	if target.user == "" {
		target.user = firstNonEmptyParam(target.params, "user", "username")
	}
	if target.user == "" {
		target.user = defaultHiveUser
	}
	if target.password == "" {
		target.password = firstNonEmptyParam(target.params, "password")
	}
	if target.database == "" {
		target.database = firstNonEmptyParam(target.params, "database", "db", "schema")
	}
	if target.database == "" {
		target.database = defaultHiveDatabase
	}
	if sslParam := strings.ToLower(strings.TrimSpace(firstNonEmptyParam(target.params, "ssl", "useSSL", "tls"))); sslParam != "" {
		switch sslParam {
		case "true", "1", "required", "skip-verify", "preferred":
			target.useSSL = true
		}
	}
	return target
}

func parseHiveConnectionParams(raw string) url.Values {
	values := url.Values{}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return values
	}
	normalized := strings.ReplaceAll(trimmed, ";", "&")
	parsed, err := url.ParseQuery(normalized)
	if err != nil {
		return values
	}
	for k, v := range parsed {
		if key := strings.TrimSpace(k); key != "" {
			values[key] = v
		}
	}
	return values
}

func applyHiveURI(target *hiveResolvedTarget, rawURI string) {
	text := strings.TrimSpace(rawURI)
	if len(text) > len("jdbc:") && strings.EqualFold(text[:len("jdbc:")], "jdbc:") {
		text = text[len("jdbc:"):]
	}
	var semiPart string
	if semiIdx := strings.Index(text, ";"); semiIdx >= 0 {
		semiPart = text[semiIdx+1:]
		text = text[:semiIdx]
	}
	parsed, err := url.Parse(text)
	if err != nil {
		return
	}
	if host := strings.TrimSpace(parsed.Hostname()); host != "" {
		target.host = host
	}
	if portText := strings.TrimSpace(parsed.Port()); portText != "" {
		if port, err := strconv.Atoi(portText); err == nil && port > 0 {
			target.port = port
		}
	}
	if parsed.User != nil {
		if u := strings.TrimSpace(parsed.User.Username()); u != "" && target.user == "" {
			target.user = u
		}
		if p, ok := parsed.User.Password(); ok && target.password == "" {
			target.password = p
		}
	}
	if dbPath := strings.Trim(strings.TrimSpace(parsed.Path), "/"); dbPath != "" && target.database == "" {
		target.database = dbPath
	}
	for k, v := range parsed.Query() {
		if _, exists := target.params[k]; !exists {
			target.params[k] = v
		}
	}
	for k, v := range parseHiveConnectionParams(semiPart) {
		if _, exists := target.params[k]; !exists {
			target.params[k] = v
		}
	}
}

func isHiveNoSASL(params url.Values) bool {
	auth := strings.ToLower(strings.TrimSpace(firstNonEmptyParam(params, "auth", "authentication")))
	if auth == "nosasl" || auth == "no_sasl" || auth == "none_nosasl" || auth == "raw" {
		return true
	}
	sasl := strings.ToLower(strings.TrimSpace(firstNonEmptyParam(params, "sasl", "useSasl", "use_sasl")))
	return sasl == "false" || sasl == "0" || sasl == "no"
}

func buildHiveSessionConfiguration(database string, params url.Values) map[string]string {
	conf := map[string]string{
		"set:hiveconf:hive.resultset.use.unique.column.names": "false",
	}
	if db := strings.TrimSpace(database); db != "" {
		conf["use:database"] = db
	}
	for key, values := range params {
		if len(values) == 0 {
			continue
		}
		val := strings.TrimSpace(values[len(values)-1])
		lower := strings.ToLower(strings.TrimSpace(key))
		switch {
		case strings.HasPrefix(lower, "hiveconf:"):
			conf["set:"+strings.TrimSpace(key)] = val
		case strings.HasPrefix(lower, "hivevar:"):
			conf["set:"+strings.TrimSpace(key)] = val
		case strings.HasPrefix(lower, "set:"):
			conf[strings.TrimSpace(key)] = val
		case strings.HasPrefix(lower, "hive.") || strings.HasPrefix(lower, "tez.") || strings.HasPrefix(lower, "mapreduce."):
			conf["set:hiveconf:"+strings.TrimSpace(key)] = val
		}
	}
	return conf
}

func (h *HiveDB) Connect(config connection.ConnectionConfig) (err error) {
	_ = h.Close()
	defer func() {
		if err != nil {
			_ = h.Close()
		}
	}()

	target := resolveHiveTarget(config)
	h.timeout = getConnectTimeout(config)
	h.database = target.database
	serverHost := target.host
	dialHost := target.host
	dialPort := target.port

	if config.UseSSH {
		forwarder, sshErr := ssh.AcquireLocalForwarder(config.SSH, target.host, target.port)
		if sshErr != nil {
			return fmt.Errorf("创建 Hive SSH 隧道失败：%w", sshErr)
		}
		h.forwarder = forwarder
		host, portText, splitErr := net.SplitHostPort(forwarder.LocalAddr)
		if splitErr != nil {
			return fmt.Errorf("解析本地转发地址失败：%w", splitErr)
		}
		port, portErr := strconv.Atoi(portText)
		if portErr != nil {
			return fmt.Errorf("解析本地转发端口失败：%w", portErr)
		}
		dialHost, dialPort = host, port
	}

	ctx, cancel := context.WithTimeout(context.Background(), h.timeout)
	defer cancel()

	address := net.JoinHostPort(dialHost, strconv.Itoa(dialPort))
	var rawConn net.Conn
	if config.UseProxy {
		rawConn, err = proxytunnel.DialContext(ctx, config.Proxy, "tcp", address)
	} else {
		rawConn, err = (&net.Dialer{KeepAlive: 30 * time.Second}).DialContext(ctx, "tcp", address)
	}
	if err != nil {
		return err
	}

	if target.useSSL {
		sslConfig := config
		sslConfig.UseSSL = true
		if strings.TrimSpace(sslConfig.SSLMode) == "" {
			sslConfig.SSLMode = "required"
		}
		tlsCfg, tlsErr := resolveGenericTLSConfig(sslConfig)
		if tlsErr != nil {
			_ = rawConn.Close()
			return tlsErr
		}
		if tlsCfg == nil {
			tlsCfg = &tls.Config{MinVersion: tls.VersionTLS12}
		} else {
			tlsCfg = tlsCfg.Clone()
		}
		if tlsCfg.ServerName == "" {
			tlsCfg.ServerName = serverHost
		}
		tlsConn := tls.Client(rawConn, tlsCfg)
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			_ = rawConn.Close()
			return err
		}
		rawConn = tlsConn
	}

	noSASL := isHiveNoSASL(target.params)
	framed := !noSASL || strings.EqualFold(firstNonEmptyParam(target.params, "transport", "transportMode"), "framed")
	h.transport = newHiveTransport(rawConn, framed)
	if !noSASL {
		if err := h.transport.handshakeSASLPlain(ctx, target.user, target.password); err != nil {
			return err
		}
	}

	sessionConf := buildHiveSessionConfiguration(target.database, target.params)
	sessionID, serverProto, err := h.transport.openSession(ctx, hiveProtocolV11, target.user, target.password, sessionConf)
	if err != nil {
		return err
	}
	h.sessionID = sessionID
	h.serverProto = serverProto
	h.currentDB = target.database

	version, verErr := h.detectVersion(ctx)
	if verErr != nil {
		return verErr
	}
	if err := h.resolve("hive", config, version); err != nil {
		return err
	}
	if target.database != "" && !strings.EqualFold(target.database, defaultHiveDatabase) {
		if _, err := h.execStatementOnSession(ctx, "USE "+quoteHiveIdent(target.database)); err != nil {
			return err
		}
		h.currentDB = target.database
	}
	return nil
}

func (h *HiveDB) detectVersion(ctx context.Context) (string, error) {
	rows, _, err := h.queryStatementOnSession(ctx, "SELECT version() AS version", nil)
	if err != nil {
		return "", err
	}
	raw := FirstQueryRowValue(rows)
	return parseHiveVersion(raw), nil
}

func parseHiveVersion(banner string) string {
	match := hiveVersionPattern.FindStringSubmatch(strings.TrimSpace(banner))
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func (h *HiveDB) Close() error {
	h.execMu.Lock()
	defer h.execMu.Unlock()
	var firstErr error
	if h.transport != nil {
		if len(h.sessionID.guid) > 0 {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			_ = h.transport.closeSession(ctx, h.sessionID)
			cancel()
			h.sessionID = hiveHandleID{}
		}
		if err := h.transport.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
		h.transport = nil
	}
	if h.forwarder != nil {
		if err := h.forwarder.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
		h.forwarder = nil
	}
	return firstErr
}

func (h *HiveDB) Ping() error {
	ctx, cancel := context.WithTimeout(context.Background(), h.timeoutOrDefault())
	defer cancel()
	_, _, err := h.QueryContext(ctx, "SELECT 1")
	return err
}

func (h *HiveDB) timeoutOrDefault() time.Duration {
	if h.timeout > 0 {
		return h.timeout
	}
	return 15 * time.Second
}
