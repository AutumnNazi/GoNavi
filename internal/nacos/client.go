package nacos

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/tlsconfig"
)

const (
	defaultNacosPort        = 8848
	defaultNacosContextPath = "/nacos"
	defaultNacosTimeout     = 30 * time.Second
	defaultConfigPageSize   = 20
	maxConfigPageSize       = 200
	tokenRefreshSkew        = 60 * time.Second
)

// ClientImpl is an HTTP OpenAPI v1 client for Nacos.
type ClientImpl struct {
	mu          sync.Mutex
	config      connection.ConnectionConfig
	httpClient  *http.Client
	baseURL     *url.URL
	accessToken string
	tokenExpiry time.Time
}

// NewClient creates a new Nacos client instance.
func NewClient() Client {
	return &ClientImpl{}
}

// Connect prepares the HTTP client and validates reachability.
func (c *ClientImpl) Connect(config connection.ConnectionConfig) error {
	normalized, err := normalizeNacosConfig(config)
	if err != nil {
		return err
	}

	httpClient, baseURL, err := buildNacosHTTPClient(normalized)
	if err != nil {
		return err
	}

	c.mu.Lock()
	c.config = normalized
	c.httpClient = httpClient
	c.baseURL = baseURL
	c.accessToken = ""
	c.tokenExpiry = time.Time{}
	c.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), normalizeNacosTimeout(normalized.Timeout))
	defer cancel()
	if err := c.ensureAuth(ctx); err != nil {
		_ = c.Close()
		return err
	}
	if err := c.Ping(ctx); err != nil {
		_ = c.Close()
		return err
	}
	return nil
}

// Close releases client resources.
func (c *ClientImpl) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.httpClient = nil
	c.baseURL = nil
	c.accessToken = ""
	c.tokenExpiry = time.Time{}
	return nil
}

// Ping checks server reachability via namespace list (works with/without auth).
func (c *ClientImpl) Ping(ctx context.Context) error {
	if _, err := c.ListNamespaces(ctx); err != nil {
		return err
	}
	return nil
}

// ListNamespaces returns all namespaces including public.
func (c *ClientImpl) ListNamespaces(ctx context.Context) ([]Namespace, error) {
	body, status, err := c.doRequest(ctx, http.MethodGet, "/v1/console/namespaces", nil, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, localizedNacosBackendError("nacos.backend.error.http_status", map[string]any{
			"status": status,
			"body":   truncateForError(string(body)),
		})
	}

	var payload struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    []struct {
			Namespace         string `json:"namespace"`
			NamespaceShowName string `json:"namespaceShowName"`
			NamespaceDesc     string `json:"namespaceDesc"`
			Quota             int64  `json:"quota"`
			ConfigCount       int64  `json:"configCount"`
			Type              int    `json:"type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, localizedNacosBackendError("nacos.backend.error.parse_namespaces", map[string]any{
			"detail": err.Error(),
		})
	}
	if payload.Code != 0 && payload.Code != 200 {
		return nil, localizedNacosBackendError("nacos.backend.error.api_code", map[string]any{
			"code":    payload.Code,
			"message": strings.TrimSpace(payload.Message),
		})
	}

	result := make([]Namespace, 0, len(payload.Data))
	for _, item := range payload.Data {
		id := strings.TrimSpace(item.Namespace)
		showName := strings.TrimSpace(item.NamespaceShowName)
		if showName == "" {
			if id == "" {
				showName = "public"
			} else {
				showName = id
			}
		}
		result = append(result, Namespace{
			ID:          id,
			ShowName:    showName,
			Description: strings.TrimSpace(item.NamespaceDesc),
			ConfigCount: item.ConfigCount,
			Quota:       item.Quota,
			Type:        item.Type,
		})
	}
	return result, nil
}

// SearchConfigs lists configs under a namespace with optional filters.
func (c *ClientImpl) SearchConfigs(ctx context.Context, query ConfigQuery) (*ConfigPage, error) {
	pageNo := query.PageNo
	if pageNo <= 0 {
		pageNo = 1
	}
	pageSize := query.PageSize
	if pageSize <= 0 {
		pageSize = defaultConfigPageSize
	}
	if pageSize > maxConfigPageSize {
		pageSize = maxConfigPageSize
	}
	searchMode := strings.ToLower(strings.TrimSpace(query.Search))
	if searchMode == "" {
		searchMode = "blur"
	}

	params := url.Values{}
	params.Set("search", searchMode)
	params.Set("dataId", strings.TrimSpace(query.DataID))
	params.Set("group", strings.TrimSpace(query.Group))
	params.Set("appName", strings.TrimSpace(query.AppName))
	params.Set("tenant", normalizeNamespaceID(query.NamespaceID))
	params.Set("pageNo", strconv.Itoa(pageNo))
	params.Set("pageSize", strconv.Itoa(pageSize))

	body, status, err := c.doRequest(ctx, http.MethodGet, "/v1/cs/configs", params, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, localizedNacosBackendError("nacos.backend.error.http_status", map[string]any{
			"status": status,
			"body":   truncateForError(string(body)),
		})
	}

	var payload struct {
		TotalCount     int64 `json:"totalCount"`
		PageNumber     int   `json:"pageNumber"`
		PagesAvailable int   `json:"pagesAvailable"`
		PageItems      []struct {
			ID               string `json:"id"`
			DataID           string `json:"dataId"`
			Group            string `json:"group"`
			Content          string `json:"content"`
			MD5              string `json:"md5"`
			Tenant           string `json:"tenant"`
			AppName          string `json:"appName"`
			Type             string `json:"type"`
			Desc             string `json:"desc"`
			LastModifiedTime any    `json:"lastModifiedTime"`
			ModifiedTime     any    `json:"modifiedTime"`
		} `json:"pageItems"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, localizedNacosBackendError("nacos.backend.error.parse_configs", map[string]any{
			"detail": err.Error(),
		})
	}

	items := make([]ConfigItem, 0, len(payload.PageItems))
	for _, item := range payload.PageItems {
		items = append(items, ConfigItem{
			ID:           strings.TrimSpace(item.ID),
			DataID:       strings.TrimSpace(item.DataID),
			Group:        strings.TrimSpace(item.Group),
			NamespaceID:  normalizeNamespaceID(item.Tenant),
			Content:      item.Content,
			Type:         strings.TrimSpace(item.Type),
			MD5:          strings.TrimSpace(item.MD5),
			AppName:      strings.TrimSpace(item.AppName),
			Desc:         strings.TrimSpace(item.Desc),
			ModifiedTime: stringifyAnyTime(item.LastModifiedTime, item.ModifiedTime),
		})
	}
	return &ConfigPage{
		TotalCount:     payload.TotalCount,
		PageNumber:     payload.PageNumber,
		PagesAvailable: payload.PagesAvailable,
		PageItems:      items,
	}, nil
}

// ListConfigGroups returns unique config groups under a namespace.
func (c *ClientImpl) ListConfigGroups(ctx context.Context, namespaceID string) ([]string, error) {
	const pageSize = 100
	pageNo := 1
	seen := make(map[string]struct{})
	groups := make([]string, 0, 16)

	for {
		page, err := c.SearchConfigs(ctx, ConfigQuery{
			NamespaceID: namespaceID,
			PageNo:      pageNo,
			PageSize:    pageSize,
			Search:      "blur",
		})
		if err != nil {
			return nil, err
		}
		if page == nil || len(page.PageItems) == 0 {
			break
		}
		for _, item := range page.PageItems {
			group := strings.TrimSpace(item.Group)
			if group == "" {
				group = "DEFAULT_GROUP"
			}
			if _, ok := seen[group]; ok {
				continue
			}
			seen[group] = struct{}{}
			groups = append(groups, group)
		}
		if pageNo >= page.PagesAvailable || len(page.PageItems) < pageSize {
			break
		}
		pageNo++
		if pageNo > 200 {
			break
		}
	}

	sort.Strings(groups)
	return groups, nil
}

// GetConfig loads a single config content.
func (c *ClientImpl) GetConfig(ctx context.Context, namespaceID, group, dataID string) (*ConfigDetail, error) {
	dataID = strings.TrimSpace(dataID)
	group = strings.TrimSpace(group)
	if dataID == "" {
		return nil, localizedNacosBackendError("nacos.backend.error.data_id_required", nil)
	}
	if group == "" {
		group = "DEFAULT_GROUP"
	}

	params := url.Values{}
	params.Set("dataId", dataID)
	params.Set("group", group)
	params.Set("tenant", normalizeNamespaceID(namespaceID))
	params.Set("show", "all")

	body, status, err := c.doRequest(ctx, http.MethodGet, "/v1/cs/configs", params, nil)
	if err != nil {
		return nil, err
	}
	if status == http.StatusNotFound {
		return nil, localizedNacosBackendError("nacos.backend.error.config_not_found", map[string]any{
			"dataId": dataID,
			"group":  group,
		})
	}
	if status < 200 || status >= 300 {
		return nil, localizedNacosBackendError("nacos.backend.error.http_status", map[string]any{
			"status": status,
			"body":   truncateForError(string(body)),
		})
	}

	// Some Nacos builds return plain text content; others return JSON when show=all.
	trimmed := strings.TrimSpace(string(body))
	if strings.HasPrefix(trimmed, "{") {
		var payload struct {
			DataID  string `json:"dataId"`
			Group   string `json:"group"`
			Content string `json:"content"`
			Type    string `json:"type"`
			MD5     string `json:"md5"`
			AppName string `json:"appName"`
			Desc    string `json:"desc"`
			Tenant  string `json:"tenant"`
		}
		if err := json.Unmarshal(body, &payload); err == nil && (payload.Content != "" || payload.DataID != "") {
			md5Value := strings.TrimSpace(payload.MD5)
			if md5Value == "" {
				md5Value = ContentMD5(payload.Content)
			}
			return &ConfigDetail{
				DataID:      firstNonEmpty(payload.DataID, dataID),
				Group:       firstNonEmpty(payload.Group, group),
				NamespaceID: normalizeNamespaceID(firstNonEmpty(payload.Tenant, namespaceID)),
				Content:     payload.Content,
				Type:        strings.TrimSpace(payload.Type),
				MD5:         md5Value,
				AppName:     strings.TrimSpace(payload.AppName),
				Desc:        strings.TrimSpace(payload.Desc),
			}, nil
		}
	}

	content := string(body)
	return &ConfigDetail{
		DataID:      dataID,
		Group:       group,
		NamespaceID: normalizeNamespaceID(namespaceID),
		Content:     content,
		MD5:         ContentMD5(content),
	}, nil
}

// PublishConfig creates or updates a config.
func (c *ClientImpl) PublishConfig(ctx context.Context, req PublishRequest) error {
	dataID := strings.TrimSpace(req.DataID)
	group := strings.TrimSpace(req.Group)
	if dataID == "" {
		return localizedNacosBackendError("nacos.backend.error.data_id_required", nil)
	}
	if group == "" {
		group = "DEFAULT_GROUP"
	}

	form := url.Values{}
	form.Set("dataId", dataID)
	form.Set("group", group)
	form.Set("content", req.Content)
	form.Set("tenant", normalizeNamespaceID(req.NamespaceID))
	if typ := strings.TrimSpace(req.Type); typ != "" {
		form.Set("type", typ)
	}
	if appName := strings.TrimSpace(req.AppName); appName != "" {
		form.Set("appName", appName)
	}
	if desc := strings.TrimSpace(req.Desc); desc != "" {
		form.Set("desc", desc)
	}
	if betaIPs := strings.TrimSpace(req.BetaIPs); betaIPs != "" {
		form.Set("betaIps", betaIPs)
	}

	body, status, err := c.doRequest(ctx, http.MethodPost, "/v1/cs/configs", nil, form)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return localizedNacosBackendError("nacos.backend.error.http_status", map[string]any{
			"status": status,
			"body":   truncateForError(string(body)),
		})
	}
	text := strings.TrimSpace(string(body))
	if text == "true" || text == "" {
		return nil
	}
	// Some versions wrap JSON result
	var boolResult bool
	if err := json.Unmarshal(body, &boolResult); err == nil && boolResult {
		return nil
	}
	if strings.EqualFold(text, "ok") {
		return nil
	}
	return localizedNacosBackendError("nacos.backend.error.publish_failed", map[string]any{
		"body": truncateForError(text),
	})
}

// DeleteConfig removes a config.
func (c *ClientImpl) DeleteConfig(ctx context.Context, namespaceID, group, dataID string) error {
	dataID = strings.TrimSpace(dataID)
	group = strings.TrimSpace(group)
	if dataID == "" {
		return localizedNacosBackendError("nacos.backend.error.data_id_required", nil)
	}
	if group == "" {
		group = "DEFAULT_GROUP"
	}

	params := url.Values{}
	params.Set("dataId", dataID)
	params.Set("group", group)
	params.Set("tenant", normalizeNamespaceID(namespaceID))

	body, status, err := c.doRequest(ctx, http.MethodDelete, "/v1/cs/configs", params, nil)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return localizedNacosBackendError("nacos.backend.error.http_status", map[string]any{
			"status": status,
			"body":   truncateForError(string(body)),
		})
	}
	text := strings.TrimSpace(string(body))
	if text == "true" || text == "" || strings.EqualFold(text, "ok") {
		return nil
	}
	var boolResult bool
	if err := json.Unmarshal(body, &boolResult); err == nil && boolResult {
		return nil
	}
	return localizedNacosBackendError("nacos.backend.error.delete_failed", map[string]any{
		"body": truncateForError(text),
	})
}

// GetBetaConfig loads beta/gray config if present.
func (c *ClientImpl) GetBetaConfig(ctx context.Context, namespaceID, group, dataID string) (*BetaConfigDetail, error) {
	dataID = strings.TrimSpace(dataID)
	group = strings.TrimSpace(group)
	if dataID == "" {
		return nil, localizedNacosBackendError("nacos.backend.error.data_id_required", nil)
	}
	if group == "" {
		group = "DEFAULT_GROUP"
	}

	params := url.Values{}
	params.Set("dataId", dataID)
	params.Set("group", group)
	params.Set("tenant", normalizeNamespaceID(namespaceID))
	params.Set("beta", "true")
	params.Set("show", "all")

	body, status, err := c.doRequest(ctx, http.MethodGet, "/v1/cs/configs", params, nil)
	if err != nil {
		return nil, err
	}
	if status == http.StatusNotFound {
		return &BetaConfigDetail{
			DataID:      dataID,
			Group:       group,
			NamespaceID: normalizeNamespaceID(namespaceID),
			Exists:      false,
		}, nil
	}
	if status < 200 || status >= 300 {
		// Some versions return 400/500 when beta does not exist; treat common empty cases as missing.
		text := strings.TrimSpace(string(body))
		if text == "" || strings.Contains(strings.ToLower(text), "not found") || strings.Contains(text, "config data not exist") {
			return &BetaConfigDetail{
				DataID:      dataID,
				Group:       group,
				NamespaceID: normalizeNamespaceID(namespaceID),
				Exists:      false,
			}, nil
		}
		return nil, localizedNacosBackendError("nacos.backend.error.http_status", map[string]any{
			"status": status,
			"body":   truncateForError(text),
		})
	}

	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return &BetaConfigDetail{
			DataID:      dataID,
			Group:       group,
			NamespaceID: normalizeNamespaceID(namespaceID),
			Exists:      false,
		}, nil
	}
	if strings.HasPrefix(trimmed, "{") {
		var payload struct {
			DataID  string `json:"dataId"`
			Group   string `json:"group"`
			Content string `json:"content"`
			Type    string `json:"type"`
			MD5     string `json:"md5"`
			BetaIPs string `json:"betaIps"`
			Tenant  string `json:"tenant"`
		}
		if err := json.Unmarshal(body, &payload); err == nil {
			content := payload.Content
			if strings.TrimSpace(content) == "" && strings.TrimSpace(payload.DataID) == "" {
				return &BetaConfigDetail{
					DataID:      dataID,
					Group:       group,
					NamespaceID: normalizeNamespaceID(namespaceID),
					Exists:      false,
				}, nil
			}
			md5Value := strings.TrimSpace(payload.MD5)
			if md5Value == "" {
				md5Value = ContentMD5(content)
			}
			return &BetaConfigDetail{
				DataID:      firstNonEmpty(payload.DataID, dataID),
				Group:       firstNonEmpty(payload.Group, group),
				NamespaceID: normalizeNamespaceID(firstNonEmpty(payload.Tenant, namespaceID)),
				Content:     content,
				Type:        strings.TrimSpace(payload.Type),
				MD5:         md5Value,
				BetaIPs:     strings.TrimSpace(payload.BetaIPs),
				Exists:      true,
			}, nil
		}
	}

	return &BetaConfigDetail{
		DataID:      dataID,
		Group:       group,
		NamespaceID: normalizeNamespaceID(namespaceID),
		Content:     string(body),
		MD5:         ContentMD5(string(body)),
		Exists:      true,
	}, nil
}

// StopBetaConfig stops beta/gray publish for a config.
func (c *ClientImpl) StopBetaConfig(ctx context.Context, namespaceID, group, dataID string) error {
	dataID = strings.TrimSpace(dataID)
	group = strings.TrimSpace(group)
	if dataID == "" {
		return localizedNacosBackendError("nacos.backend.error.data_id_required", nil)
	}
	if group == "" {
		group = "DEFAULT_GROUP"
	}

	// Preferred console-compatible path.
	params := url.Values{}
	params.Set("dataId", dataID)
	params.Set("group", group)
	params.Set("tenant", normalizeNamespaceID(namespaceID))
	body, status, err := c.doRequest(ctx, http.MethodDelete, "/v1/cs/configs/beta", params, nil)
	if err == nil && status >= 200 && status < 300 {
		return parseNacosBoolResult(body, status, "nacos.backend.error.beta_stop_failed")
	}

	// Fallback: DELETE configs with beta=true.
	params2 := url.Values{}
	params2.Set("dataId", dataID)
	params2.Set("group", group)
	params2.Set("tenant", normalizeNamespaceID(namespaceID))
	params2.Set("beta", "true")
	body2, status2, err2 := c.doRequest(ctx, http.MethodDelete, "/v1/cs/configs", params2, nil)
	if err2 != nil {
		if err != nil {
			return err
		}
		return err2
	}
	return parseNacosBoolResult(body2, status2, "nacos.backend.error.beta_stop_failed")
}

// CreateNamespace creates a namespace.
func (c *ClientImpl) CreateNamespace(ctx context.Context, req CreateNamespaceRequest) error {
	showName := strings.TrimSpace(req.ShowName)
	if showName == "" {
		return localizedNacosBackendError("nacos.backend.error.namespace_name_required", nil)
	}
	nsID := strings.TrimSpace(req.ID)
	if strings.EqualFold(nsID, "public") || nsID == "" && strings.EqualFold(showName, "public") {
		// Creating another "public" is not allowed; empty id with non-public name is ok.
		if strings.EqualFold(showName, "public") {
			return localizedNacosBackendError("nacos.backend.error.namespace_public_reserved", nil)
		}
	}

	form := url.Values{}
	form.Set("customNamespaceId", nsID)
	form.Set("namespaceName", showName)
	form.Set("namespaceDesc", strings.TrimSpace(req.Description))

	body, status, err := c.doRequest(ctx, http.MethodPost, "/v1/console/namespaces", nil, form)
	if err != nil {
		return err
	}
	return parseNacosBoolResult(body, status, "nacos.backend.error.namespace_create_failed")
}

// UpdateNamespace updates namespace show name / description.
func (c *ClientImpl) UpdateNamespace(ctx context.Context, req UpdateNamespaceRequest) error {
	nsID := strings.TrimSpace(req.ID)
	// public is represented as empty id; do not allow renaming public id, but updating show name is usually blocked by server.
	if nsID == "" || strings.EqualFold(nsID, "public") {
		return localizedNacosBackendError("nacos.backend.error.namespace_public_immutable", nil)
	}
	showName := strings.TrimSpace(req.ShowName)
	if showName == "" {
		return localizedNacosBackendError("nacos.backend.error.namespace_name_required", nil)
	}

	form := url.Values{}
	form.Set("namespace", nsID)
	form.Set("namespaceShowName", showName)
	form.Set("namespaceDesc", strings.TrimSpace(req.Description))

	body, status, err := c.doRequest(ctx, http.MethodPut, "/v1/console/namespaces", nil, form)
	if err != nil {
		return err
	}
	return parseNacosBoolResult(body, status, "nacos.backend.error.namespace_update_failed")
}

// DeleteNamespace deletes a namespace by id.
func (c *ClientImpl) DeleteNamespace(ctx context.Context, namespaceID string) error {
	nsID := strings.TrimSpace(namespaceID)
	if nsID == "" || strings.EqualFold(nsID, "public") {
		return localizedNacosBackendError("nacos.backend.error.namespace_public_immutable", nil)
	}

	// Prefer query parameters: Go's ParseForm ignores DELETE bodies, and many
	// Nacos deployments accept namespaceId on the query string.
	params := url.Values{}
	params.Set("namespaceId", nsID)

	body, status, err := c.doRequest(ctx, http.MethodDelete, "/v1/console/namespaces", params, nil)
	if err != nil {
		return err
	}
	return parseNacosBoolResult(body, status, "nacos.backend.error.namespace_delete_failed")
}

// ListConfigHistory lists history records for a config.
func (c *ClientImpl) ListConfigHistory(ctx context.Context, query HistoryQuery) (*HistoryPage, error) {
	dataID := strings.TrimSpace(query.DataID)
	group := strings.TrimSpace(query.Group)
	if dataID == "" {
		return nil, localizedNacosBackendError("nacos.backend.error.data_id_required", nil)
	}
	if group == "" {
		group = "DEFAULT_GROUP"
	}
	pageNo := query.PageNo
	if pageNo <= 0 {
		pageNo = 1
	}
	pageSize := query.PageSize
	if pageSize <= 0 {
		pageSize = defaultConfigPageSize
	}
	if pageSize > maxConfigPageSize {
		pageSize = maxConfigPageSize
	}

	params := url.Values{}
	params.Set("search", "accurate")
	params.Set("dataId", dataID)
	params.Set("group", group)
	params.Set("tenant", normalizeNamespaceID(query.NamespaceID))
	params.Set("pageNo", strconv.Itoa(pageNo))
	params.Set("pageSize", strconv.Itoa(pageSize))

	body, status, err := c.doRequest(ctx, http.MethodGet, "/v1/cs/history", params, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, localizedNacosBackendError("nacos.backend.error.http_status", map[string]any{
			"status": status,
			"body":   truncateForError(string(body)),
		})
	}

	var payload struct {
		TotalCount     int64 `json:"totalCount"`
		PageNumber     int   `json:"pageNumber"`
		PagesAvailable int   `json:"pagesAvailable"`
		PageItems      []struct {
			ID               any    `json:"id"`
			LastID           any    `json:"lastId"`
			DataID           string `json:"dataId"`
			Group            string `json:"group"`
			Tenant           string `json:"tenant"`
			AppName          string `json:"appName"`
			MD5              string `json:"md5"`
			Content          string `json:"content"`
			SrcIP            string `json:"srcIp"`
			SrcUser          string `json:"srcUser"`
			OpType           string `json:"opType"`
			CreatedTime      any    `json:"createdTime"`
			LastModifiedTime any    `json:"lastModifiedTime"`
		} `json:"pageItems"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, localizedNacosBackendError("nacos.backend.error.parse_history", map[string]any{
			"detail": err.Error(),
		})
	}

	items := make([]HistoryItem, 0, len(payload.PageItems))
	for _, item := range payload.PageItems {
		items = append(items, HistoryItem{
			ID:           stringifyAnyID(item.ID),
			LastID:       stringifyAnyID(item.LastID),
			DataID:       strings.TrimSpace(item.DataID),
			Group:        strings.TrimSpace(item.Group),
			NamespaceID:  normalizeNamespaceID(item.Tenant),
			AppName:      strings.TrimSpace(item.AppName),
			MD5:          strings.TrimSpace(item.MD5),
			Content:      item.Content,
			SrcIP:        strings.TrimSpace(item.SrcIP),
			SrcUser:      strings.TrimSpace(item.SrcUser),
			OpType:       strings.TrimSpace(item.OpType),
			CreatedTime:  stringifyAnyTime(item.CreatedTime),
			ModifiedTime: stringifyAnyTime(item.LastModifiedTime),
		})
	}
	return &HistoryPage{
		TotalCount:     payload.TotalCount,
		PageNumber:     payload.PageNumber,
		PagesAvailable: payload.PagesAvailable,
		PageItems:      items,
	}, nil
}

// GetConfigHistory loads one history detail by nid.
func (c *ClientImpl) GetConfigHistory(ctx context.Context, namespaceID, group, dataID, nid string) (*HistoryItem, error) {
	dataID = strings.TrimSpace(dataID)
	group = strings.TrimSpace(group)
	nid = strings.TrimSpace(nid)
	if dataID == "" {
		return nil, localizedNacosBackendError("nacos.backend.error.data_id_required", nil)
	}
	if nid == "" {
		return nil, localizedNacosBackendError("nacos.backend.error.history_id_required", nil)
	}
	if group == "" {
		group = "DEFAULT_GROUP"
	}

	params := url.Values{}
	params.Set("nid", nid)
	params.Set("dataId", dataID)
	params.Set("group", group)
	params.Set("tenant", normalizeNamespaceID(namespaceID))

	body, status, err := c.doRequest(ctx, http.MethodGet, "/v1/cs/history", params, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, localizedNacosBackendError("nacos.backend.error.http_status", map[string]any{
			"status": status,
			"body":   truncateForError(string(body)),
		})
	}

	var payload struct {
		ID               any    `json:"id"`
		LastID           any    `json:"lastId"`
		DataID           string `json:"dataId"`
		Group            string `json:"group"`
		Tenant           string `json:"tenant"`
		AppName          string `json:"appName"`
		MD5              string `json:"md5"`
		Content          string `json:"content"`
		SrcIP            string `json:"srcIp"`
		SrcUser          string `json:"srcUser"`
		OpType           string `json:"opType"`
		CreatedTime      any    `json:"createdTime"`
		LastModifiedTime any    `json:"lastModifiedTime"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, localizedNacosBackendError("nacos.backend.error.parse_history", map[string]any{
			"detail": err.Error(),
		})
	}
	return &HistoryItem{
		ID:           firstNonEmpty(stringifyAnyID(payload.ID), nid),
		LastID:       stringifyAnyID(payload.LastID),
		DataID:       firstNonEmpty(strings.TrimSpace(payload.DataID), dataID),
		Group:        firstNonEmpty(strings.TrimSpace(payload.Group), group),
		NamespaceID:  normalizeNamespaceID(firstNonEmpty(payload.Tenant, namespaceID)),
		AppName:      strings.TrimSpace(payload.AppName),
		MD5:          strings.TrimSpace(payload.MD5),
		Content:      payload.Content,
		SrcIP:        strings.TrimSpace(payload.SrcIP),
		SrcUser:      strings.TrimSpace(payload.SrcUser),
		OpType:       strings.TrimSpace(payload.OpType),
		CreatedTime:  stringifyAnyTime(payload.CreatedTime),
		ModifiedTime: stringifyAnyTime(payload.LastModifiedTime),
	}, nil
}

func parseNacosBoolResult(body []byte, status int, failKey string) error {
	if status < 200 || status >= 300 {
		return localizedNacosBackendError("nacos.backend.error.http_status", map[string]any{
			"status": status,
			"body":   truncateForError(string(body)),
		})
	}
	text := strings.TrimSpace(string(body))
	if text == "true" || text == "" || strings.EqualFold(text, "ok") {
		return nil
	}
	var boolResult bool
	if err := json.Unmarshal(body, &boolResult); err == nil && boolResult {
		return nil
	}
	// Some console APIs return {"code":200,...}
	var wrapped struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    any    `json:"data"`
	}
	if err := json.Unmarshal(body, &wrapped); err == nil && (wrapped.Code == 0 || wrapped.Code == 200) {
		switch v := wrapped.Data.(type) {
		case bool:
			if v {
				return nil
			}
		case string:
			if v == "true" || v == "" {
				return nil
			}
		case nil:
			return nil
		}
	}
	return localizedNacosBackendError(failKey, map[string]any{
		"body": truncateForError(text),
	})
}

func stringifyAnyID(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(v)
	case float64:
		// avoid scientific notation for large ids
		return strconv.FormatInt(int64(v), 10)
	case json.Number:
		return v.String()
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func (c *ClientImpl) ensureAuth(ctx context.Context) error {
	c.mu.Lock()
	username := strings.TrimSpace(c.config.User)
	password := c.config.Password
	needLogin := username != ""
	tokenValid := c.accessToken != "" && time.Now().Before(c.tokenExpiry.Add(-tokenRefreshSkew))
	c.mu.Unlock()

	if !needLogin {
		return nil
	}
	if tokenValid {
		return nil
	}
	return c.login(ctx, username, password)
}

func (c *ClientImpl) login(ctx context.Context, username, password string) error {
	form := url.Values{}
	form.Set("username", username)
	form.Set("password", password)

	body, status, err := c.doRequestRaw(ctx, http.MethodPost, "/v1/auth/login", nil, form, false)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return localizedNacosBackendError("nacos.backend.error.login_failed", map[string]any{
			"status": status,
			"body":   truncateForError(string(body)),
		})
	}

	var payload struct {
		AccessToken string `json:"accessToken"`
		TokenTtl    int64  `json:"tokenTtl"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return localizedNacosBackendError("nacos.backend.error.login_parse", map[string]any{
			"detail": err.Error(),
		})
	}
	token := strings.TrimSpace(payload.AccessToken)
	if token == "" {
		return localizedNacosBackendError("nacos.backend.error.login_empty_token", nil)
	}
	ttl := payload.TokenTtl
	if ttl <= 0 {
		ttl = 18000
	}

	c.mu.Lock()
	c.accessToken = token
	c.tokenExpiry = time.Now().Add(time.Duration(ttl) * time.Second)
	c.mu.Unlock()
	return nil
}

func (c *ClientImpl) doRequest(ctx context.Context, method, apiPath string, query url.Values, form url.Values) ([]byte, int, error) {
	if err := c.ensureAuth(ctx); err != nil {
		return nil, 0, err
	}
	body, status, err := c.doRequestRaw(ctx, method, apiPath, query, form, true)
	if err != nil {
		return nil, status, err
	}
	// Token expired mid-flight: force re-login once.
	if status == http.StatusForbidden || status == http.StatusUnauthorized {
		c.mu.Lock()
		c.accessToken = ""
		c.tokenExpiry = time.Time{}
		c.mu.Unlock()
		if err := c.ensureAuth(ctx); err != nil {
			return nil, status, err
		}
		return c.doRequestRaw(ctx, method, apiPath, query, form, true)
	}
	return body, status, nil
}

func (c *ClientImpl) doRequestRaw(
	ctx context.Context,
	method, apiPath string,
	query url.Values,
	form url.Values,
	withToken bool,
) ([]byte, int, error) {
	c.mu.Lock()
	httpClient := c.httpClient
	baseURL := c.baseURL
	token := c.accessToken
	c.mu.Unlock()

	if httpClient == nil || baseURL == nil {
		return nil, 0, localizedNacosBackendError("nacos.backend.error.not_connected", nil)
	}

	rel := &url.URL{Path: joinAPIPath(baseURL.Path, apiPath)}
	if query == nil {
		query = url.Values{}
	}
	if withToken && strings.TrimSpace(token) != "" {
		query.Set("accessToken", token)
	}
	rel.RawQuery = query.Encode()
	fullURL := baseURL.ResolveReference(rel).String()

	var bodyReader io.Reader
	contentType := ""
	if form != nil {
		bodyReader = strings.NewReader(form.Encode())
		contentType = "application/x-www-form-urlencoded"
	}

	req, err := http.NewRequestWithContext(ctx, method, fullURL, bodyReader)
	if err != nil {
		return nil, 0, localizedNacosBackendError("nacos.backend.error.build_request", map[string]any{
			"detail": err.Error(),
		})
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Accept", "*/*")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, 0, localizedNacosBackendError("nacos.backend.error.request_failed", map[string]any{
			"detail": err.Error(),
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, resp.StatusCode, localizedNacosBackendError("nacos.backend.error.read_body", map[string]any{
			"detail": err.Error(),
		})
	}
	return body, resp.StatusCode, nil
}

func normalizeNacosConfig(config connection.ConnectionConfig) (connection.ConnectionConfig, error) {
	run := config
	run.Type = "nacos"
	run.Host = strings.TrimSpace(run.Host)
	if run.Host == "" {
		return run, localizedNacosBackendError("nacos.backend.error.host_required", nil)
	}
	if run.Port <= 0 {
		run.Port = defaultNacosPort
	}
	if run.Timeout <= 0 {
		run.Timeout = int(defaultNacosTimeout / time.Second)
	}
	return run, nil
}

func buildNacosHTTPClient(config connection.ConnectionConfig) (*http.Client, *url.URL, error) {
	scheme := "http"
	if config.UseSSL || strings.EqualFold(strings.TrimSpace(config.SSLMode), "required") ||
		strings.EqualFold(strings.TrimSpace(config.SSLMode), "preferred") {
		scheme = "https"
	}

	contextPath := resolveNacosContextPath(config)
	base, err := url.Parse(fmt.Sprintf("%s://%s", scheme, net.JoinHostPort(config.Host, strconv.Itoa(config.Port))))
	if err != nil {
		return nil, nil, localizedNacosBackendError("nacos.backend.error.invalid_address", map[string]any{
			"detail": err.Error(),
		})
	}
	base.Path = contextPath

	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          32,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	if config.UseProxy && strings.EqualFold(strings.TrimSpace(config.Proxy.Type), "http") {
		proxyHost := strings.TrimSpace(config.Proxy.Host)
		if proxyHost != "" {
			proxyPort := config.Proxy.Port
			if proxyPort <= 0 {
				proxyPort = 8080
			}
			proxyURL := &url.URL{
				Scheme: "http",
				Host:   net.JoinHostPort(proxyHost, strconv.Itoa(proxyPort)),
			}
			if user := strings.TrimSpace(config.Proxy.User); user != "" {
				if pass := config.Proxy.Password; pass != "" {
					proxyURL.User = url.UserPassword(user, pass)
				} else {
					proxyURL.User = url.User(user)
				}
			}
			transport.Proxy = http.ProxyURL(proxyURL)
		}
	}

	if scheme == "https" {
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
			return nil, nil, localizedNacosBackendError("nacos.backend.error.tls_setup_failed", map[string]any{
				"detail": err.Error(),
			})
		}
		if tlsCfg != nil {
			transport.TLSClientConfig = tlsCfg
		} else {
			transport.TLSClientConfig = &tls.Config{
				MinVersion:         tls.VersionTLS12,
				InsecureSkipVerify: insecure, //nolint:gosec
			}
		}
	}

	client := &http.Client{
		Timeout:   normalizeNacosTimeout(config.Timeout),
		Transport: transport,
	}
	return client, base, nil
}

func resolveNacosContextPath(config connection.ConnectionConfig) string {
	// Prefer connectionParams contextPath=...
	params := parseSimpleKV(config.ConnectionParams)
	if v := strings.TrimSpace(params["contextPath"]); v != "" {
		return normalizeContextPath(v)
	}
	// Allow Database field to carry context path as a convenience.
	if v := strings.TrimSpace(config.Database); v != "" && strings.Contains(v, "/") {
		return normalizeContextPath(v)
	}
	return defaultNacosContextPath
}

func normalizeContextPath(raw string) string {
	path := strings.TrimSpace(raw)
	if path == "" || path == "/" {
		return ""
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return strings.TrimRight(path, "/")
}

func joinAPIPath(basePath, apiPath string) string {
	base := strings.TrimRight(strings.TrimSpace(basePath), "/")
	api := strings.TrimSpace(apiPath)
	if api == "" {
		return base
	}
	if !strings.HasPrefix(api, "/") {
		api = "/" + api
	}
	return base + api
}

func normalizeNamespaceID(raw string) string {
	id := strings.TrimSpace(raw)
	if strings.EqualFold(id, "public") {
		return ""
	}
	return id
}

func normalizeNacosTimeout(seconds int) time.Duration {
	if seconds <= 0 {
		return defaultNacosTimeout
	}
	return time.Duration(seconds) * time.Second
}

func parseSimpleKV(raw string) map[string]string {
	result := make(map[string]string)
	text := strings.TrimSpace(raw)
	if text == "" {
		return result
	}
	// Support both "a=b&c=d" and "a=b;c=d" and newline-separated pairs.
	replacer := strings.NewReplacer(";", "&", "\n", "&")
	text = replacer.Replace(text)
	values, err := url.ParseQuery(text)
	if err == nil {
		for key, vals := range values {
			if len(vals) > 0 {
				result[strings.TrimSpace(key)] = strings.TrimSpace(vals[0])
			}
		}
		return result
	}
	for _, part := range strings.Split(text, "&") {
		key, value, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		result[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	return result
}

func truncateForError(text string) string {
	const max = 400
	trimmed := strings.TrimSpace(text)
	if len(trimmed) <= max {
		return trimmed
	}
	return trimmed[:max] + "..."
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func stringifyAnyTime(values ...any) string {
	for _, v := range values {
		switch t := v.(type) {
		case nil:
			continue
		case string:
			if s := strings.TrimSpace(t); s != "" {
				return s
			}
		case float64:
			// millis or seconds
			if t > 1e12 {
				return time.UnixMilli(int64(t)).Format(time.RFC3339)
			}
			if t > 0 {
				return time.Unix(int64(t), 0).Format(time.RFC3339)
			}
		case json.Number:
			if i, err := t.Int64(); err == nil {
				if i > 1e12 {
					return time.UnixMilli(i).Format(time.RFC3339)
				}
				if i > 0 {
					return time.Unix(i, 0).Format(time.RFC3339)
				}
			}
		default:
			s := strings.TrimSpace(fmt.Sprint(t))
			if s != "" && s != "<nil>" {
				return s
			}
		}
	}
	return ""
}
