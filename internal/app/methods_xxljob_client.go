package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/xxljob"

	"golang.org/x/sync/singleflight"
)

const defaultXxlJobOperationTimeoutSeconds = 30

var (
	xxlJobCache        = make(map[string]*xxljob.Client)
	xxlJobCacheMu      sync.Mutex
	xxlJobConnectGroup singleflight.Group
)

var errXxlJobCacheInvalidated = errors.New("XXL-JOB 连接缓存已关闭")

// formatXxlJobConnSummary renders a log-safe connection summary. It never
// includes the password, the context path is reduced to its presence, and the
// login cookie is not part of the client's observable state here.
func formatXxlJobConnSummary(config connection.ConnectionConfig) string {
	var b strings.Builder
	b.WriteString("类型=xxljob 地址=")
	b.WriteString(strings.TrimSpace(config.Host))
	b.WriteString(":")
	b.WriteString(strconv.Itoa(config.Port))
	if config.UseSSL {
		b.WriteString(" SSL=on")
	}
	if user := strings.TrimSpace(config.User); user != "" {
		b.WriteString(" 用户=")
		b.WriteString(user)
	}
	if strings.Contains(config.ConnectionParams, "contextPath") {
		b.WriteString(" contextPath=已设置")
	}
	if config.UseSSH {
		b.WriteString(" SSH=on")
	}
	return b.String()
}

// getXxlJobClientCacheKey fingerprints everything that changes the transport or
// the session, so a password edit or a new context path opens a fresh client
// instead of reusing a stale session.
func getXxlJobClientCacheKey(config connection.ConnectionConfig) string {
	normalized := normalizeCacheKeyConfig(config)
	identity := struct {
		Type                  string `json:"type"`
		Host                  string `json:"host"`
		Port                  int    `json:"port"`
		User                  string `json:"user"`
		Password              string `json:"password"`
		UseSSL                bool   `json:"useSSL"`
		SSLMode               string `json:"sslMode"`
		SSLCAPath             string `json:"sslCapath"`
		SSLCertPath           string `json:"sslCertPath"`
		SSLKeyPath            string `json:"sslKeyPath"`
		ConnectionParams      string `json:"connectionParams"`
		Database              string `json:"database"`
		UseSSH                bool   `json:"useSSH"`
		SSHHost               string `json:"sshHost"`
		SSHPort               int    `json:"sshPort"`
		SSHUser               string `json:"sshUser"`
		SSHPassword           string `json:"sshPassword"`
		SSHKeyPath            string `json:"sshKeyPath"`
		SSHKnownHostsPath     string `json:"sshKnownHostsPath"`
		SSHHostKeyFingerprint string `json:"sshHostKeyFingerprint"`
		UseProxy              bool   `json:"useProxy"`
		ProxyType             string `json:"proxyType"`
		ProxyHost             string `json:"proxyHost"`
		ProxyPort             int    `json:"proxyPort"`
		ProxyUser             string `json:"proxyUser"`
		ProxyPassword         string `json:"proxyPassword"`
		UseHTTPTunnel         bool   `json:"useHttpTunnel"`
		HTTPTunnelHost        string `json:"httpTunnelHost"`
		HTTPTunnelPort        int    `json:"httpTunnelPort"`
		HTTPTunnelUser        string `json:"httpTunnelUser"`
		HTTPTunnelPassword    string `json:"httpTunnelPassword"`
	}{
		Type:                  "xxljob",
		Host:                  strings.TrimSpace(normalized.Host),
		Port:                  normalized.Port,
		User:                  strings.TrimSpace(normalized.User),
		Password:              normalized.Password,
		UseSSL:                normalized.UseSSL,
		SSLMode:               strings.TrimSpace(normalized.SSLMode),
		SSLCAPath:             strings.TrimSpace(normalized.SSLCAPath),
		SSLCertPath:           strings.TrimSpace(normalized.SSLCertPath),
		SSLKeyPath:            strings.TrimSpace(normalized.SSLKeyPath),
		ConnectionParams:      strings.TrimSpace(normalized.ConnectionParams),
		Database:              strings.TrimSpace(normalized.Database),
		UseSSH:                normalized.UseSSH,
		SSHHost:               strings.TrimSpace(normalized.SSH.Host),
		SSHPort:               normalized.SSH.Port,
		SSHUser:               strings.TrimSpace(normalized.SSH.User),
		SSHPassword:           normalized.SSH.Password,
		SSHKeyPath:            strings.TrimSpace(normalized.SSH.KeyPath),
		SSHKnownHostsPath:     strings.TrimSpace(normalized.SSH.KnownHostsPath),
		SSHHostKeyFingerprint: strings.TrimSpace(normalized.SSH.HostKeyFingerprint),
		UseProxy:              normalized.UseProxy,
		ProxyType:             strings.TrimSpace(normalized.Proxy.Type),
		ProxyHost:             strings.TrimSpace(normalized.Proxy.Host),
		ProxyPort:             normalized.Proxy.Port,
		ProxyUser:             strings.TrimSpace(normalized.Proxy.User),
		ProxyPassword:         normalized.Proxy.Password,
		UseHTTPTunnel:         normalized.UseHTTPTunnel,
		HTTPTunnelHost:        strings.TrimSpace(normalized.HTTPTunnel.Host),
		HTTPTunnelPort:        normalized.HTTPTunnel.Port,
		HTTPTunnelUser:        strings.TrimSpace(normalized.HTTPTunnel.User),
		HTTPTunnelPassword:    normalized.HTTPTunnel.Password,
	}
	raw, _ := json.Marshal(identity)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func xxlJobOperationTimeoutSeconds(config connection.ConnectionConfig) int {
	if config.Timeout <= 0 {
		return defaultXxlJobOperationTimeoutSeconds
	}
	return config.Timeout
}

func (a *App) xxlJobOperationContext(config connection.ConnectionConfig) (context.Context, context.CancelFunc) {
	return context.WithTimeout(
		context.Background(),
		time.Duration(xxlJobOperationTimeoutSeconds(config))*time.Second,
	)
}

func (a *App) getXxlJobClient(config connection.ConnectionConfig) (*xxljob.Client, error) {
	ctx, cancel := a.xxlJobOperationContext(config)
	defer cancel()
	return a.getXxlJobClientWithContext(ctx, config)
}

// getXxlJobClientWithContext returns a cached client for the connection, opening
// one through the shared singleflight so concurrent panel loads open a single
// session rather than one per table.
func (a *App) getXxlJobClientWithContext(
	ctx context.Context,
	config connection.ConnectionConfig,
) (*xxljob.Client, error) {
	if ctx == nil {
		return nil, fmt.Errorf("XXL-JOB 连接上下文不能为空")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	resolvedConfig, err := a.resolveConnectionSecrets(config)
	if err != nil {
		wrapped := wrapConnectError(config, err)
		logger.Error(wrapped, "XXL-JOB 密文解析失败：%s", formatXxlJobConnSummary(config))
		return nil, wrapped
	}
	effectiveConfig := a.withManagedSSHHostKeyTrustStore(resolvedConfig)
	connectConfig, proxyErr := resolveDialConfigWithProxyFunc(effectiveConfig)
	if proxyErr != nil {
		wrapped := wrapConnectError(effectiveConfig, proxyErr)
		logger.Error(wrapped, "XXL-JOB 代理准备失败：%s", formatXxlJobConnSummary(effectiveConfig))
		return nil, wrapped
	}
	connectConfig.Type = "xxljob"

	cacheIdentityConfig := effectiveConfig
	cacheIdentityConfig.Type = "xxljob"
	key := getXxlJobClientCacheKey(cacheIdentityConfig)

	xxlJobCacheMu.Lock()
	cached := xxlJobCache[key]
	xxlJobCacheMu.Unlock()
	if cached != nil {
		return cached, nil
	}

	flightKey := key + ":" + strconv.Itoa(xxlJobOperationTimeoutSeconds(connectConfig))
	opened, err, _ := xxlJobConnectGroup.Do(flightKey, func() (any, error) {
		xxlJobCacheMu.Lock()
		published := xxlJobCache[key]
		xxlJobCacheMu.Unlock()
		if published != nil {
			return published, nil
		}
		client := xxljob.NewClient()
		if _, connectErr := client.Connect(ctx, connectConfig); connectErr != nil {
			_ = client.Close()
			return nil, connectErr
		}
		xxlJobCacheMu.Lock()
		// Re-check under the lock: another flight may have published while this
		// one was connecting, and two live sessions would both hold cookies.
		if existing := xxlJobCache[key]; existing != nil {
			xxlJobCacheMu.Unlock()
			_ = client.Close()
			return existing, nil
		}
		xxlJobCache[key] = client
		xxlJobCacheMu.Unlock()
		return client, nil
	})
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, wrapConnectError(connectConfig, err)
	}
	client, ok := opened.(*xxljob.Client)
	if !ok || client == nil {
		return nil, errXxlJobCacheInvalidated
	}
	return client, nil
}

// CloseAllXxlJobClients closes every cached XXL-JOB client.
func CloseAllXxlJobClients() {
	xxlJobCacheMu.Lock()
	clients := xxlJobCache
	xxlJobCache = make(map[string]*xxljob.Client)
	xxlJobCacheMu.Unlock()

	closed := 0
	for _, client := range clients {
		if client != nil {
			_ = client.Close()
			closed++
		}
	}
	if closed > 0 {
		logger.Infof("已关闭 %d 个 XXL-JOB 连接", closed)
	}
}

// XxlJobTestConnection validates credentials without publishing the client to the
// cache, so a failed attempt leaves no session behind.
func (a *App) XxlJobTestConnection(config connection.ConnectionConfig) connection.QueryResult {
	config.Type = "xxljob"
	ctx, cancel := a.xxlJobOperationContext(config)
	defer cancel()

	resolvedConfig, err := a.resolveConnectionSecrets(config)
	if err != nil {
		wrapped := wrapConnectError(config, err)
		logger.Error(wrapped, "XXL-JOB 测试连接密文解析失败：%s", formatXxlJobConnSummary(config))
		return connection.QueryResult{Success: false, Message: wrapped.Error()}
	}
	effectiveConfig := a.withManagedSSHHostKeyTrustStore(resolvedConfig)
	connectConfig, proxyErr := resolveDialConfigWithProxyFunc(effectiveConfig)
	if proxyErr != nil {
		wrapped := wrapConnectError(effectiveConfig, proxyErr)
		return connection.QueryResult{Success: false, Message: wrapped.Error()}
	}
	connectConfig.Type = "xxljob"

	client := xxljob.NewClient()
	defer client.Close()
	info, err := client.Connect(ctx, connectConfig)
	if err != nil {
		logger.Error(err, "XXL-JOB 测试连接失败：%s", formatXxlJobConnSummary(connectConfig))
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{
		Success: true,
		Message: a.appText("xxljob.backend.message.connect_success", nil),
		Data:    info,
	}
}

// XxlJobConnect opens and caches a session, reporting the detected protocol
// stack so the connection detail can show which dialect is in use.
func (a *App) XxlJobConnect(config connection.ConnectionConfig) connection.QueryResult {
	config.Type = "xxljob"
	ctx, cancel := a.xxlJobOperationContext(config)
	defer cancel()

	client, err := a.getXxlJobClientWithContext(ctx, config)
	if err != nil {
		if trustResult, ok := a.sshHostKeyTrustRequiredResult(err); ok {
			logger.Warnf("XxlJobConnect 需要确认 SSH 服务端身份：%s", formatXxlJobConnSummary(config))
			return trustResult
		}
		logger.Error(err, "XxlJobConnect 连接失败：%s", formatXxlJobConnSummary(config))
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	logger.Infof("XxlJobConnect 连接成功：%s", formatXxlJobConnSummary(config))
	return connection.QueryResult{
		Success: true,
		Message: a.appText("xxljob.backend.message.connect_success", nil),
		Data:    map[string]any{"protocolFamily": client.ProtocolFamily()},
	}
}

// XxlJobDisconnect drops the cached session for one connection.
func (a *App) XxlJobDisconnect(config connection.ConnectionConfig) connection.QueryResult {
	config.Type = "xxljob"
	closed := a.releaseXxlJobClientsForConfig(config)
	return connection.QueryResult{Success: true, Data: map[string]int{"closed": closed}}
}

// releaseXxlJobClientsForConfig closes every cached client whose identity matches
// the connection. Secrets are resolved first so a saved connection released from
// the sidebar (whose config carries secret references, not plaintext) matches the
// key the client was cached under.
func (a *App) releaseXxlJobClientsForConfig(config connection.ConnectionConfig) int {
	resolved, err := a.resolveConnectionSecrets(config)
	if err != nil {
		// 密文解析失败的连接不可能有已缓存的会话（缓存 key 由解析后的密文参与计算）。
		return 0
	}
	effective := a.withManagedSSHHostKeyTrustStore(resolved)
	effective.Type = "xxljob"
	targetKey := getXxlJobClientCacheKey(effective)

	xxlJobCacheMu.Lock()
	var victims []*xxljob.Client
	if client := xxlJobCache[targetKey]; client != nil {
		delete(xxlJobCache, targetKey)
		victims = append(victims, client)
	}
	xxlJobCacheMu.Unlock()

	closed := 0
	for _, client := range victims {
		_ = client.Close()
		closed++
	}
	if closed > 0 {
		logger.Infof("XxlJobDisconnect 已释放 XXL-JOB 会话：%s 数量=%d", formatXxlJobConnSummary(effective), closed)
	}
	return closed
}
