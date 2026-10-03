//go:build gonavi_full_drivers || gonavi_weaviate_driver

package db

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	proxytunnel "GoNavi-Wails/internal/proxy"
	"GoNavi-Wails/internal/ssh"
)

// weaviateHTTPError 是服务端已返回的 HTTP 错误；传输层错误不是这个类型，写入时据此判断结果是否未知。
type weaviateHTTPError struct {
	status  int
	message string
}

func (e *weaviateHTTPError) Error() string { return e.message }

// normalizeWeaviateConfig 解析 http(s):// 与 weaviate:// 连接串，补默认主机与端口。
func normalizeWeaviateConfig(config connection.ConnectionConfig) connection.ConnectionConfig {
	runConfig := applyWeaviateURI(rewriteURIScheme(config, "http", "weaviate"))
	if strings.TrimSpace(runConfig.Host) == "" {
		runConfig.Host = "localhost"
	}
	if runConfig.Port <= 0 {
		runConfig.Port = defaultWeaviatePort
	}
	if strings.TrimSpace(runConfig.SSLMode) == "" && runConfig.UseSSL {
		runConfig.SSLMode = "required"
	}
	return runConfig
}

func applyWeaviateURI(config connection.ConnectionConfig) connection.ConnectionConfig {
	text := strings.TrimSpace(config.URI)
	if text == "" {
		return config
	}
	parsed, err := url.Parse(text)
	if err != nil {
		return config
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return config
	}
	if scheme == "https" {
		config.UseSSL = true
	}
	if parsed.User != nil {
		if pass, ok := parsed.User.Password(); ok && config.Password == "" {
			config.Password = pass
		}
	}
	if host := parsed.Hostname(); host != "" {
		config.Host = host
		config.Port = 0
		if port, err := strconv.Atoi(parsed.Port()); err == nil && port > 0 {
			config.Port = port
		} else if scheme == "https" && parsed.Port() == "" {
			config.Port = 443
		}
	}
	return config
}

func buildWeaviateBaseURL(config connection.ConnectionConfig) string {
	scheme := "http"
	if config.UseSSL {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s", scheme, net.JoinHostPort(strings.TrimSpace(config.Host), strconv.Itoa(config.Port)))
}

func weaviateConnectionParams(config connection.ConnectionConfig) url.Values {
	params := url.Values{}
	mergeConnectionParamValues(params, connectionParamsFromURI(config.URI, "http", "https", "weaviate"))
	mergeConnectionParamValues(params, connectionParamsFromText(config.ConnectionParams))
	return params
}

// weaviateTenantFromConfig 返回当前租户：导航树选中的库（default 表示不指定租户），其次是 tenant 连接参数。
func weaviateTenantFromConfig(config connection.ConnectionConfig) string {
	if name := strings.TrimSpace(config.Database); name != "" && name != weaviateDefaultNamespace {
		return name
	}
	return strings.TrimSpace(weaviateConnectionParams(config).Get("tenant"))
}

// weaviateAuthHeaders 组装认证头：API key（密码字段或 apiKey 参数）走 Bearer；
// header.<名称>=<值> 参数原样带上，用于向量化模块的密钥（如 header.X-OpenAI-Api-Key）。
func weaviateAuthHeaders(config connection.ConnectionConfig) map[string]string {
	headers := make(map[string]string)
	params := weaviateConnectionParams(config)
	apiKey := ""
	for _, name := range []string{"apiKey", "apikey", "api-key", "token", "authToken"} {
		if value := strings.TrimSpace(params.Get(name)); value != "" {
			apiKey = value
			break
		}
	}
	if apiKey == "" {
		apiKey = strings.TrimSpace(config.Password)
	}
	if apiKey != "" {
		headers["Authorization"] = "Bearer " + apiKey
	}
	for name, values := range params {
		if len(name) <= len("header.") || !strings.EqualFold(name[:len("header.")], "header.") || len(values) == 0 {
			continue
		}
		headerName := strings.TrimSpace(name[len("header."):])
		if value := strings.TrimSpace(values[0]); value != "" && isSafeConnectionParamKey(headerName) && !strings.Contains(headerName, " ") {
			headers[headerName] = value
		}
	}
	return headers
}

func buildWeaviateHTTPClient(config connection.ConnectionConfig) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	dialTimeout := getConnectTimeout(config)
	transport.DialContext = (&net.Dialer{Timeout: dialTimeout, KeepAlive: 30 * time.Second}).DialContext
	if tlsConfig, err := resolveGenericTLSConfig(config); err == nil && tlsConfig != nil {
		transport.TLSClientConfig = tlsConfig
	}
	if config.UseProxy {
		proxyCfg := config.Proxy
		transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			dialCtx, cancel := context.WithTimeout(ctx, dialTimeout)
			defer cancel()
			return proxytunnel.DialContext(dialCtx, proxyCfg, network, addr)
		}
	}
	return &http.Client{Transport: transport}
}

// forwardThroughSSH 建立 SSH 本地转发，返回改写为本地地址的配置。
func (w *WeaviateDB) forwardThroughSSH(config connection.ConnectionConfig) (connection.ConnectionConfig, error) {
	forwarder, err := ssh.AcquireLocalForwarder(config.SSH, config.Host, config.Port)
	if err != nil {
		return config, localizedDatabaseRuntimeError("db.backend.error.ssh_tunnel_create_failed", map[string]any{"detail": err.Error()})
	}
	w.forwarder = forwarder
	host, portText, splitErr := net.SplitHostPort(forwarder.LocalAddr)
	port, convErr := strconv.Atoi(portText)
	if splitErr != nil || convErr != nil {
		return config, localizedDatabaseRuntimeError("db.backend.error.ssh_local_forward_addr_invalid", map[string]any{"address": forwarder.LocalAddr})
	}
	logger.Infof("Weaviate 通过本地端口转发连接：%s -> %s:%d", forwarder.LocalAddr, config.Host, config.Port)
	config.Host, config.Port, config.UseSSH = host, port, false
	return config, nil
}

// doRaw 发出请求并返回 2xx 响应体；body 为 nil 时不带请求体。
func (w *WeaviateDB) doRaw(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	if w.client == nil {
		return nil, localizedDatabaseRuntimeError("db.backend.error.connection_not_open", nil)
	}
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(w.baseURL, "/")+path, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	for key, value := range w.authHeaders {
		req.Header.Set(key, value)
	}
	res, err := w.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	resBody, err := readLimitedJSONResponseBody(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		detail := weaviateErrorDetail(resBody)
		if detail == "" {
			detail = res.Status
		}
		return nil, &weaviateHTTPError{
			status: res.StatusCode,
			message: localizedDriverRuntimeText("db.backend.error.weaviate_request_failed", map[string]any{
				"method": method,
				"path":   path,
				"detail": detail,
			}),
		}
	}
	return resBody, nil
}

// doJSON 发出 JSON 请求并把响应解码到 out（out 为 nil 时忽略响应体）。
func (w *WeaviateDB) doJSON(ctx context.Context, method, path string, body interface{}, out interface{}) error {
	var payload []byte
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = encoded
	}
	resBody, err := w.doRaw(ctx, method, path, payload)
	if err != nil {
		return err
	}
	if out == nil || len(bytes.TrimSpace(resBody)) == 0 {
		return nil
	}
	return decodeJSONWithUseNumber(resBody, out)
}

// graphQL 执行 GraphQL 查询；响应带 errors 时整体按失败处理，避免部分结果被当成完整结果。
func (w *WeaviateDB) graphQL(ctx context.Context, query string) (map[string]interface{}, error) {
	var response struct {
		Data   map[string]interface{} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := w.doJSON(ctx, http.MethodPost, "/v1/graphql", map[string]string{"query": query}, &response); err != nil {
		return nil, err
	}
	if len(response.Errors) > 0 {
		messages := make([]string, 0, len(response.Errors))
		for _, item := range response.Errors {
			if text := strings.TrimSpace(item.Message); text != "" {
				messages = append(messages, text)
			}
		}
		return nil, localizedDatabaseRuntimeError("db.backend.error.weaviate_graphql_failed", map[string]any{"detail": strings.Join(messages, "; ")})
	}
	return response.Data, nil
}

// weaviateErrorDetail 取出 {"error":[{"message":...}]} 或 {"message":...} 形式的错误说明。
func weaviateErrorDetail(body []byte) string {
	var payload struct {
		Error []struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &payload); err == nil {
		messages := make([]string, 0, len(payload.Error)+1)
		for _, item := range payload.Error {
			if text := strings.TrimSpace(item.Message); text != "" {
				messages = append(messages, text)
			}
		}
		if text := strings.TrimSpace(payload.Message); text != "" {
			messages = append(messages, text)
		}
		if len(messages) > 0 {
			return strings.Join(messages, "; ")
		}
	}
	return strings.TrimSpace(string(body))
}

// weaviateEscapePath 转义路径段（集合名、对象 ID、租户名）。
func weaviateEscapePath(segment string) string { return url.PathEscape(segment) }

// weaviateTenantQuery 返回带租户的查询串（含前导 ?）；租户为空时返回空串。
func weaviateTenantQuery(tenant string) string {
	if tenant == "" {
		return ""
	}
	return "?tenant=" + url.QueryEscape(tenant)
}
