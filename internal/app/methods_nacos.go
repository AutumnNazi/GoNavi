package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/nacos"
)

var (
	nacosCache         = make(map[string]nacos.Client)
	nacosCacheConfigs  = make(map[string]connection.ConnectionConfig)
	nacosCacheMu       sync.Mutex
	newNacosClientFunc = nacos.NewClient
)

// NacosConfigQuery is the frontend search payload.
type NacosConfigQuery struct {
	NamespaceID string `json:"namespaceId"`
	DataID      string `json:"dataId,omitempty"`
	Group       string `json:"group,omitempty"`
	AppName     string `json:"appName,omitempty"`
	PageNo      int    `json:"pageNo,omitempty"`
	PageSize    int    `json:"pageSize,omitempty"`
	Search      string `json:"search,omitempty"`
}

// NacosPublishConfigPayload is the frontend publish payload.
type NacosPublishConfigPayload struct {
	NamespaceID string `json:"namespaceId"`
	DataID      string `json:"dataId"`
	Group       string `json:"group"`
	Content     string `json:"content"`
	Type        string `json:"type,omitempty"`
	AppName     string `json:"appName,omitempty"`
	Desc        string `json:"desc,omitempty"`
	BetaIPs     string `json:"betaIps,omitempty"`
}

// NacosConfigIdentity identifies one config by dataId + group.
// Named type (not anonymous) so wailsjs models.ts generation stays valid.
type NacosConfigIdentity struct {
	DataID string `json:"dataId"`
	Group  string `json:"group"`
}

// NacosExportConfigsOptions controls config export.
type NacosExportConfigsOptions struct {
	NamespaceID   string                `json:"namespaceId"`
	NamespaceName string                `json:"namespaceName,omitempty"`
	Scope         string                `json:"scope,omitempty"` // all | selected
	Items         []NacosConfigIdentity `json:"items,omitempty"`
}

// NacosImportConfigsOptions controls config import.
type NacosImportConfigsOptions struct {
	NamespaceID  string                `json:"namespaceId"`
	ConflictMode string                `json:"conflictMode,omitempty"` // skip | overwrite
	File         string                `json:"file,omitempty"`
	Scope        string                `json:"scope,omitempty"` // all | selected
	Items        []NacosConfigIdentity `json:"items,omitempty"`
}

// NacosCreateNamespacePayload creates a namespace.
type NacosCreateNamespacePayload struct {
	ID          string `json:"id"`
	ShowName    string `json:"showName"`
	Description string `json:"description,omitempty"`
}

// NacosUpdateNamespacePayload updates a namespace.
type NacosUpdateNamespacePayload struct {
	ID          string `json:"id"`
	ShowName    string `json:"showName"`
	Description string `json:"description,omitempty"`
}

// NacosHistoryQuery lists config history.
type NacosHistoryQuery struct {
	NamespaceID string `json:"namespaceId"`
	DataID      string `json:"dataId"`
	Group       string `json:"group"`
	PageNo      int    `json:"pageNo,omitempty"`
	PageSize    int    `json:"pageSize,omitempty"`
}

// NacosServiceQuery lists services.
type NacosServiceQuery struct {
	NamespaceID string `json:"namespaceId"`
	GroupName   string `json:"groupName,omitempty"`
	PageNo      int    `json:"pageNo,omitempty"`
	PageSize    int    `json:"pageSize,omitempty"`
}

// NacosServicePayload creates/updates a service.
type NacosServicePayload struct {
	NamespaceID      string            `json:"namespaceId"`
	ServiceName      string            `json:"serviceName"`
	GroupName        string            `json:"groupName,omitempty"`
	ProtectThreshold float64           `json:"protectThreshold,omitempty"`
	Metadata         map[string]string `json:"metadata,omitempty"`
}

// NacosInstanceQuery lists instances.
type NacosInstanceQuery struct {
	NamespaceID string `json:"namespaceId"`
	ServiceName string `json:"serviceName"`
	GroupName   string `json:"groupName,omitempty"`
	Clusters    string `json:"clusters,omitempty"`
	HealthyOnly bool   `json:"healthyOnly,omitempty"`
}

// NacosInstancePayload mutates an instance.
type NacosInstancePayload struct {
	NamespaceID string            `json:"namespaceId"`
	ServiceName string            `json:"serviceName"`
	GroupName   string            `json:"groupName,omitempty"`
	IP          string            `json:"ip"`
	Port        int               `json:"port"`
	ClusterName string            `json:"clusterName,omitempty"`
	Weight      float64           `json:"weight,omitempty"`
	Enabled     *bool             `json:"enabled,omitempty"`
	Healthy     *bool             `json:"healthy,omitempty"`
	Ephemeral   *bool             `json:"ephemeral,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

func formatNacosConnSummary(config connection.ConnectionConfig) string {
	var b strings.Builder
	b.WriteString("类型=nacos 地址=")
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
	if params := strings.TrimSpace(config.ConnectionParams); params != "" {
		b.WriteString(" params=")
		b.WriteString(params)
	}
	return b.String()
}

func getNacosClientCacheKey(config connection.ConnectionConfig) string {
	normalized := normalizeCacheKeyConfig(config)
	raw := strings.Join([]string{
		"nacos",
		strings.TrimSpace(normalized.Host),
		strconv.Itoa(normalized.Port),
		strings.TrimSpace(normalized.User),
		strconv.FormatBool(normalized.UseSSL),
		strings.TrimSpace(normalized.SSLMode),
		strings.TrimSpace(normalized.ConnectionParams),
		strings.TrimSpace(normalized.Database),
		strconv.FormatBool(normalized.UseProxy),
		strings.TrimSpace(normalized.Proxy.Type),
		strings.TrimSpace(normalized.Proxy.Host),
		strconv.Itoa(normalized.Proxy.Port),
		strings.TrimSpace(normalized.Proxy.User),
	}, "|")
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func (a *App) getNacosClient(config connection.ConnectionConfig) (nacos.Client, error) {
	resolvedConfig, err := a.resolveConnectionSecrets(config)
	if err != nil {
		wrapped := wrapConnectError(config, err)
		logger.Error(wrapped, "Nacos 密文解析失败：%s", formatNacosConnSummary(config))
		return nil, wrapped
	}

	connectConfig, proxyErr := resolveDialConfigWithProxyFunc(resolvedConfig)
	if proxyErr != nil {
		wrapped := wrapConnectError(resolvedConfig, proxyErr)
		logger.Error(wrapped, "Nacos 代理准备失败：%s", formatNacosConnSummary(resolvedConfig))
		return nil, wrapped
	}
	connectConfig.Type = "nacos"

	key := getNacosClientCacheKey(connectConfig)
	shortKey := key
	if len(shortKey) > 12 {
		shortKey = shortKey[:12]
	}

	nacosCacheMu.Lock()
	defer nacosCacheMu.Unlock()

	if client, ok := nacosCache[key]; ok {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		if err := client.Ping(ctx); err == nil {
			return client, nil
		} else {
			logger.Error(err, "缓存 Nacos 连接不可用，准备重建：缓存Key=%s", shortKey)
			_ = client.Close()
			delete(nacosCache, key)
			delete(nacosCacheConfigs, key)
		}
	}

	client := newNacosClientFunc()
	if err := client.Connect(connectConfig); err != nil {
		_ = client.Close()
		wrapped := wrapConnectError(connectConfig, err)
		logger.Error(wrapped, "Nacos 连接失败：%s 缓存Key=%s", formatNacosConnSummary(connectConfig), shortKey)
		return nil, wrapped
	}
	nacosCache[key] = client
	nacosCacheConfigs[key] = normalizeCacheKeyConfig(connectConfig)
	logger.Infof("Nacos 连接成功并写入缓存：%s 缓存Key=%s", formatNacosConnSummary(connectConfig), shortKey)
	return client, nil
}

func (a *App) openNacosClientIsolated(config connection.ConnectionConfig) (nacos.Client, error) {
	resolvedConfig, err := a.resolveConnectionSecrets(config)
	if err != nil {
		wrapped := wrapConnectError(config, err)
		logger.Error(wrapped, "Nacos 密文解析失败：%s", formatNacosConnSummary(config))
		return nil, wrapped
	}
	connectConfig, proxyErr := resolveDialConfigWithProxyFunc(resolvedConfig)
	if proxyErr != nil {
		wrapped := wrapConnectError(resolvedConfig, proxyErr)
		logger.Error(wrapped, "Nacos 代理准备失败：%s", formatNacosConnSummary(resolvedConfig))
		return nil, wrapped
	}
	connectConfig.Type = "nacos"
	client := newNacosClientFunc()
	if err := client.Connect(connectConfig); err != nil {
		_ = client.Close()
		wrapped := wrapConnectError(connectConfig, err)
		logger.Error(wrapped, "Nacos 临时连接失败：%s", formatNacosConnSummary(connectConfig))
		return nil, wrapped
	}
	return client, nil
}

func (a *App) nacosOperationContext(config connection.ConnectionConfig) (context.Context, context.CancelFunc) {
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = 30
	}
	return context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
}

// NacosConnect establishes and caches a Nacos connection.
func (a *App) NacosConnect(config connection.ConnectionConfig) connection.QueryResult {
	config.Type = "nacos"
	_, err := a.getNacosClient(config)
	if err != nil {
		logger.Error(err, "NacosConnect 连接失败：%s", formatNacosConnSummary(config))
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	logger.Infof("NacosConnect 连接成功：%s", formatNacosConnSummary(config))
	return connection.QueryResult{Success: true, Message: a.appText("nacos.backend.message.connect_success", nil)}
}

// NacosTestConnection tests connectivity without reusing long-lived cache.
func (a *App) NacosTestConnection(config connection.ConnectionConfig) connection.QueryResult {
	config.Type = "nacos"
	client, err := a.openNacosClientIsolated(config)
	if err != nil {
		logger.Error(err, "NacosTestConnection 连接失败：%s", formatNacosConnSummary(config))
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if client != nil {
		if closeErr := client.Close(); closeErr != nil {
			logger.Error(closeErr, "NacosTestConnection 释放临时连接失败：%s", formatNacosConnSummary(config))
			return connection.QueryResult{
				Success: false,
				Message: a.appText("nacos.backend.error.test_connection_close_failed", map[string]any{"detail": closeErr.Error()}),
			}
		}
	}
	logger.Infof("NacosTestConnection 连接成功：%s", formatNacosConnSummary(config))
	return connection.QueryResult{Success: true, Message: a.appText("nacos.backend.message.connect_success", nil)}
}

// NacosListNamespaces lists namespaces for a connection.
func (a *App) NacosListNamespaces(config connection.ConnectionConfig) connection.QueryResult {
	config.Type = "nacos"
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	namespaces, err := client.ListNamespaces(ctx)
	if err != nil {
		logger.Error(err, "NacosListNamespaces 失败：%s", formatNacosConnSummary(config))
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Data: namespaces}
}

// NacosListConfigGroups lists unique config groups under a namespace.
func (a *App) NacosListConfigGroups(config connection.ConnectionConfig, namespaceID string) connection.QueryResult {
	config.Type = "nacos"
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	groups, err := client.ListConfigGroups(ctx, namespaceID)
	if err != nil {
		logger.Error(err, "NacosListConfigGroups 失败：%s", formatNacosConnSummary(config))
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Data: groups}
}

// NacosSearchConfigs searches configs under a namespace.
func (a *App) NacosSearchConfigs(config connection.ConnectionConfig, query NacosConfigQuery) connection.QueryResult {
	config.Type = "nacos"
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	page, err := client.SearchConfigs(ctx, nacos.ConfigQuery{
		NamespaceID: query.NamespaceID,
		DataID:      query.DataID,
		Group:       query.Group,
		AppName:     query.AppName,
		PageNo:      query.PageNo,
		PageSize:    query.PageSize,
		Search:      query.Search,
	})
	if err != nil {
		logger.Error(err, "NacosSearchConfigs 失败：%s", formatNacosConnSummary(config))
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Data: page}
}

// NacosGetConfig loads one config.
func (a *App) NacosGetConfig(config connection.ConnectionConfig, namespaceID, group, dataID string) connection.QueryResult {
	config.Type = "nacos"
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	detail, err := client.GetConfig(ctx, namespaceID, group, dataID)
	if err != nil {
		logger.Error(err, "NacosGetConfig 失败：dataId=%s group=%s", dataID, group)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Data: detail}
}

// NacosPublishConfig creates or updates a config.
func (a *App) NacosPublishConfig(config connection.ConnectionConfig, payload NacosPublishConfigPayload) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosDataEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	if err := client.PublishConfig(ctx, nacos.PublishRequest{
		NamespaceID: payload.NamespaceID,
		DataID:      payload.DataID,
		Group:       payload.Group,
		Content:     payload.Content,
		Type:        payload.Type,
		AppName:     payload.AppName,
		Desc:        payload.Desc,
		BetaIPs:     payload.BetaIPs,
	}); err != nil {
		logger.Error(err, "NacosPublishConfig 失败：dataId=%s group=%s", payload.DataID, payload.Group)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	if strings.TrimSpace(payload.BetaIPs) != "" {
		return connection.QueryResult{
			Success: true,
			Message: a.appText("nacos.backend.message.beta_publish_success", nil),
		}
	}
	return connection.QueryResult{
		Success: true,
		Message: a.appText("nacos.backend.message.publish_success", nil),
	}
}

// NacosGetBetaConfig loads beta config for one dataId/group.
func (a *App) NacosGetBetaConfig(config connection.ConnectionConfig, namespaceID, group, dataID string) connection.QueryResult {
	config.Type = "nacos"
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	detail, err := client.GetBetaConfig(ctx, namespaceID, group, dataID)
	if err != nil {
		logger.Error(err, "NacosGetBetaConfig 失败：dataId=%s group=%s", dataID, group)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Data: detail}
}

// NacosStopBetaConfig stops beta publish.
func (a *App) NacosStopBetaConfig(config connection.ConnectionConfig, namespaceID, group, dataID string) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosDataEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	if err := client.StopBetaConfig(ctx, namespaceID, group, dataID); err != nil {
		logger.Error(err, "NacosStopBetaConfig 失败：dataId=%s group=%s", dataID, group)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{
		Success: true,
		Message: a.appText("nacos.backend.message.beta_stop_success", nil),
	}
}

// NacosDeleteConfig deletes a config.
func (a *App) NacosDeleteConfig(config connection.ConnectionConfig, namespaceID, group, dataID string) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosDataEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	if err := client.DeleteConfig(ctx, namespaceID, group, dataID); err != nil {
		logger.Error(err, "NacosDeleteConfig 失败：dataId=%s group=%s", dataID, group)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{
		Success: true,
		Message: a.appText("nacos.backend.message.delete_success", nil),
	}
}

// NacosCreateNamespace creates a namespace.
func (a *App) NacosCreateNamespace(config connection.ConnectionConfig, payload NacosCreateNamespacePayload) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosStructureEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	if err := client.CreateNamespace(ctx, nacos.CreateNamespaceRequest{
		ID:          payload.ID,
		ShowName:    payload.ShowName,
		Description: payload.Description,
	}); err != nil {
		logger.Error(err, "NacosCreateNamespace 失败：id=%s name=%s", payload.ID, payload.ShowName)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{
		Success: true,
		Message: a.appText("nacos.backend.message.namespace_create_success", nil),
	}
}

// NacosUpdateNamespace updates a namespace.
func (a *App) NacosUpdateNamespace(config connection.ConnectionConfig, payload NacosUpdateNamespacePayload) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosStructureEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	if err := client.UpdateNamespace(ctx, nacos.UpdateNamespaceRequest{
		ID:          payload.ID,
		ShowName:    payload.ShowName,
		Description: payload.Description,
	}); err != nil {
		logger.Error(err, "NacosUpdateNamespace 失败：id=%s", payload.ID)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{
		Success: true,
		Message: a.appText("nacos.backend.message.namespace_update_success", nil),
	}
}

// NacosDeleteNamespace deletes a namespace.
func (a *App) NacosDeleteNamespace(config connection.ConnectionConfig, namespaceID string) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosStructureEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	if err := client.DeleteNamespace(ctx, namespaceID); err != nil {
		logger.Error(err, "NacosDeleteNamespace 失败：id=%s", namespaceID)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{
		Success: true,
		Message: a.appText("nacos.backend.message.namespace_delete_success", nil),
	}
}

// NacosListConfigHistory lists history for one config.
func (a *App) NacosListConfigHistory(config connection.ConnectionConfig, query NacosHistoryQuery) connection.QueryResult {
	config.Type = "nacos"
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	page, err := client.ListConfigHistory(ctx, nacos.HistoryQuery{
		NamespaceID: query.NamespaceID,
		DataID:      query.DataID,
		Group:       query.Group,
		PageNo:      query.PageNo,
		PageSize:    query.PageSize,
	})
	if err != nil {
		logger.Error(err, "NacosListConfigHistory 失败：dataId=%s group=%s", query.DataID, query.Group)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Data: page}
}

// NacosGetConfigHistory loads one history detail.
func (a *App) NacosGetConfigHistory(config connection.ConnectionConfig, namespaceID, group, dataID, nid string) connection.QueryResult {
	config.Type = "nacos"
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	item, err := client.GetConfigHistory(ctx, namespaceID, group, dataID, nid)
	if err != nil {
		logger.Error(err, "NacosGetConfigHistory 失败：nid=%s dataId=%s", nid, dataID)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Data: item}
}

// NacosListServices lists services under a namespace.
func (a *App) NacosListServices(config connection.ConnectionConfig, query NacosServiceQuery) connection.QueryResult {
	config.Type = "nacos"
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	page, err := client.ListServices(ctx, nacos.ServiceQuery{
		NamespaceID: query.NamespaceID,
		GroupName:   query.GroupName,
		PageNo:      query.PageNo,
		PageSize:    query.PageSize,
	})
	if err != nil {
		logger.Error(err, "NacosListServices 失败：%s", formatNacosConnSummary(config))
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Data: page}
}

// NacosGetService loads service detail.
func (a *App) NacosGetService(config connection.ConnectionConfig, namespaceID, serviceName, groupName string) connection.QueryResult {
	config.Type = "nacos"
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	detail, err := client.GetService(ctx, namespaceID, serviceName, groupName)
	if err != nil {
		logger.Error(err, "NacosGetService 失败：service=%s", serviceName)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Data: detail}
}

// NacosCreateService creates a service.
func (a *App) NacosCreateService(config connection.ConnectionConfig, payload NacosServicePayload) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosStructureEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	if err := client.CreateService(ctx, nacos.CreateServiceRequest{
		NamespaceID:      payload.NamespaceID,
		ServiceName:      payload.ServiceName,
		GroupName:        payload.GroupName,
		ProtectThreshold: payload.ProtectThreshold,
		Metadata:         payload.Metadata,
	}); err != nil {
		logger.Error(err, "NacosCreateService 失败：service=%s", payload.ServiceName)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Message: a.appText("nacos.backend.message.service_create_success", nil)}
}

// NacosUpdateService updates a service.
func (a *App) NacosUpdateService(config connection.ConnectionConfig, payload NacosServicePayload) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosStructureEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	if err := client.UpdateService(ctx, nacos.UpdateServiceRequest{
		NamespaceID:      payload.NamespaceID,
		ServiceName:      payload.ServiceName,
		GroupName:        payload.GroupName,
		ProtectThreshold: payload.ProtectThreshold,
		Metadata:         payload.Metadata,
	}); err != nil {
		logger.Error(err, "NacosUpdateService 失败：service=%s", payload.ServiceName)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Message: a.appText("nacos.backend.message.service_update_success", nil)}
}

// NacosDeleteService deletes a service.
func (a *App) NacosDeleteService(config connection.ConnectionConfig, namespaceID, serviceName, groupName string) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosStructureEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	if err := client.DeleteService(ctx, namespaceID, serviceName, groupName); err != nil {
		logger.Error(err, "NacosDeleteService 失败：service=%s", serviceName)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Message: a.appText("nacos.backend.message.service_delete_success", nil)}
}

// NacosListInstances lists instances of a service.
func (a *App) NacosListInstances(config connection.ConnectionConfig, query NacosInstanceQuery) connection.QueryResult {
	config.Type = "nacos"
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	list, err := client.ListInstances(ctx, nacos.InstanceQuery{
		NamespaceID: query.NamespaceID,
		ServiceName: query.ServiceName,
		GroupName:   query.GroupName,
		Clusters:    query.Clusters,
		HealthyOnly: query.HealthyOnly,
	})
	if err != nil {
		logger.Error(err, "NacosListInstances 失败：service=%s", query.ServiceName)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Data: list}
}

// NacosGetInstance loads one instance.
func (a *App) NacosGetInstance(config connection.ConnectionConfig, payload NacosInstancePayload) connection.QueryResult {
	config.Type = "nacos"
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	inst, err := client.GetInstance(ctx, toNacosInstanceRequest(payload))
	if err != nil {
		logger.Error(err, "NacosGetInstance 失败：%s:%d", payload.IP, payload.Port)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Data: inst}
}

// NacosRegisterInstance registers an instance.
func (a *App) NacosRegisterInstance(config connection.ConnectionConfig, payload NacosInstancePayload) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosDataEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	if err := client.RegisterInstance(ctx, toNacosInstanceRequest(payload)); err != nil {
		logger.Error(err, "NacosRegisterInstance 失败：%s:%d", payload.IP, payload.Port)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Message: a.appText("nacos.backend.message.instance_register_success", nil)}
}

// NacosUpdateInstance updates an instance.
func (a *App) NacosUpdateInstance(config connection.ConnectionConfig, payload NacosInstancePayload) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosDataEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	if err := client.UpdateInstance(ctx, toNacosInstanceRequest(payload)); err != nil {
		logger.Error(err, "NacosUpdateInstance 失败：%s:%d", payload.IP, payload.Port)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Message: a.appText("nacos.backend.message.instance_update_success", nil)}
}

// NacosDeregisterInstance deregisters an instance.
func (a *App) NacosDeregisterInstance(config connection.ConnectionConfig, payload NacosInstancePayload) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosDataEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	if err := client.DeregisterInstance(ctx, toNacosInstanceRequest(payload)); err != nil {
		logger.Error(err, "NacosDeregisterInstance 失败：%s:%d", payload.IP, payload.Port)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Message: a.appText("nacos.backend.message.instance_deregister_success", nil)}
}

// NacosUpdateInstanceHealth updates instance health.
func (a *App) NacosUpdateInstanceHealth(config connection.ConnectionConfig, payload NacosInstancePayload) connection.QueryResult {
	config.Type = "nacos"
	if err := a.ensureNacosDataEditAllowed(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	client, err := a.getNacosClient(config)
	if err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	ctx, cancel := a.nacosOperationContext(config)
	defer cancel()
	if err := client.UpdateInstanceHealth(ctx, toNacosInstanceRequest(payload)); err != nil {
		logger.Error(err, "NacosUpdateInstanceHealth 失败：%s:%d", payload.IP, payload.Port)
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return connection.QueryResult{Success: true, Message: a.appText("nacos.backend.message.instance_health_success", nil)}
}

func toNacosInstanceRequest(payload NacosInstancePayload) nacos.InstanceRequest {
	return nacos.InstanceRequest{
		NamespaceID: payload.NamespaceID,
		ServiceName: payload.ServiceName,
		GroupName:   payload.GroupName,
		IP:          payload.IP,
		Port:        payload.Port,
		ClusterName: payload.ClusterName,
		Weight:      payload.Weight,
		Enabled:     payload.Enabled,
		Healthy:     payload.Healthy,
		Ephemeral:   payload.Ephemeral,
		Metadata:    payload.Metadata,
	}
}

func (a *App) ensureNacosDataEditAllowed(config connection.ConnectionConfig) error {
	// Nacos is outside the SQL read-only type set; honor explicit flags directly.
	if config.ReadOnly || config.Protection.RestrictDataEdit {
		return fmt.Errorf("%s", a.appText("nacos.backend.error.read_only", nil))
	}
	return nil
}

func (a *App) ensureNacosStructureEditAllowed(config connection.ConnectionConfig) error {
	if config.ReadOnly || config.Protection.RestrictStructureEdit || config.Protection.RestrictDataEdit {
		return fmt.Errorf("%s", a.appText("nacos.backend.error.read_only", nil))
	}
	return nil
}
