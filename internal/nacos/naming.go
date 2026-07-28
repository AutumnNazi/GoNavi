package nacos

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const (
	defaultServicePageSize = 100
	maxServicePageSize     = 500
	defaultServiceGroup    = "DEFAULT_GROUP"
)

// ListServices lists service names under a namespace.
func (c *ClientImpl) ListServices(ctx context.Context, query ServiceQuery) (*ServicePage, error) {
	pageNo := query.PageNo
	if pageNo <= 0 {
		pageNo = 1
	}
	pageSize := query.PageSize
	if pageSize <= 0 {
		pageSize = defaultServicePageSize
	}
	if pageSize > maxServicePageSize {
		pageSize = maxServicePageSize
	}

	params := url.Values{}
	params.Set("pageNo", strconv.Itoa(pageNo))
	params.Set("pageSize", strconv.Itoa(pageSize))
	params.Set("namespaceId", normalizeNamespaceID(query.NamespaceID))
	if group := strings.TrimSpace(query.GroupName); group != "" {
		params.Set("groupName", group)
	}

	body, status, err := c.doRequest(ctx, http.MethodGet, "/v1/ns/service/list", params, nil)
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
		Count int64    `json:"count"`
		Doms  []string `json:"doms"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, localizedNacosBackendError("nacos.backend.error.parse_services", map[string]any{
			"detail": err.Error(),
		})
	}
	names := make([]string, 0, len(payload.Doms))
	for _, name := range payload.Doms {
		name = strings.TrimSpace(name)
		if name != "" {
			names = append(names, name)
		}
	}
	return &ServicePage{
		Count:        payload.Count,
		ServiceNames: names,
		PageNo:       pageNo,
		PageSize:     pageSize,
	}, nil
}

// GetService loads service detail.
func (c *ClientImpl) GetService(ctx context.Context, namespaceID, serviceName, groupName string) (*ServiceDetail, error) {
	serviceName = strings.TrimSpace(serviceName)
	if serviceName == "" {
		return nil, localizedNacosBackendError("nacos.backend.error.service_name_required", nil)
	}
	groupName = normalizeServiceGroup(groupName)

	params := url.Values{}
	params.Set("serviceName", serviceName)
	params.Set("groupName", groupName)
	params.Set("namespaceId", normalizeNamespaceID(namespaceID))

	body, status, err := c.doRequest(ctx, http.MethodGet, "/v1/ns/service", params, nil)
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
		Name             string            `json:"name"`
		GroupName        string            `json:"groupName"`
		NamespaceID      string            `json:"namespaceId"`
		ProtectThreshold float64           `json:"protectThreshold"`
		Metadata         map[string]string `json:"metadata"`
		Selector         map[string]any    `json:"selector"`
		Clusters         []struct {
			Name          string            `json:"name"`
			Metadata      map[string]string `json:"metadata"`
			HealthChecker map[string]any    `json:"healthChecker"`
		} `json:"clusters"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, localizedNacosBackendError("nacos.backend.error.parse_service", map[string]any{
			"detail": err.Error(),
		})
	}

	clusters := make([]ServiceCluster, 0, len(payload.Clusters))
	for _, cluster := range payload.Clusters {
		clusters = append(clusters, ServiceCluster{
			Name:          strings.TrimSpace(cluster.Name),
			Metadata:      cluster.Metadata,
			HealthChecker: cluster.HealthChecker,
		})
	}
	return &ServiceDetail{
		Name:             firstNonEmpty(strings.TrimSpace(payload.Name), serviceName),
		GroupName:        firstNonEmpty(strings.TrimSpace(payload.GroupName), groupName),
		NamespaceID:      normalizeNamespaceID(firstNonEmpty(payload.NamespaceID, namespaceID)),
		ProtectThreshold: payload.ProtectThreshold,
		Metadata:         payload.Metadata,
		Selector:         payload.Selector,
		Clusters:         clusters,
	}, nil
}

// CreateService creates a service.
func (c *ClientImpl) CreateService(ctx context.Context, req CreateServiceRequest) error {
	serviceName := strings.TrimSpace(req.ServiceName)
	if serviceName == "" {
		return localizedNacosBackendError("nacos.backend.error.service_name_required", nil)
	}
	form := url.Values{}
	form.Set("serviceName", serviceName)
	form.Set("groupName", normalizeServiceGroup(req.GroupName))
	form.Set("namespaceId", normalizeNamespaceID(req.NamespaceID))
	if req.ProtectThreshold > 0 {
		form.Set("protectThreshold", strconv.FormatFloat(req.ProtectThreshold, 'f', -1, 64))
	}
	if meta := encodeMetadata(req.Metadata); meta != "" {
		form.Set("metadata", meta)
	}
	body, status, err := c.doRequest(ctx, http.MethodPost, "/v1/ns/service", nil, form)
	if err != nil {
		return err
	}
	return parseNamingOKResult(body, status, "nacos.backend.error.service_create_failed")
}

// UpdateService updates a service.
func (c *ClientImpl) UpdateService(ctx context.Context, req UpdateServiceRequest) error {
	serviceName := strings.TrimSpace(req.ServiceName)
	if serviceName == "" {
		return localizedNacosBackendError("nacos.backend.error.service_name_required", nil)
	}
	form := url.Values{}
	form.Set("serviceName", serviceName)
	form.Set("groupName", normalizeServiceGroup(req.GroupName))
	form.Set("namespaceId", normalizeNamespaceID(req.NamespaceID))
	if req.ProtectThreshold > 0 {
		form.Set("protectThreshold", strconv.FormatFloat(req.ProtectThreshold, 'f', -1, 64))
	}
	if meta := encodeMetadata(req.Metadata); meta != "" {
		form.Set("metadata", meta)
	}
	body, status, err := c.doRequest(ctx, http.MethodPut, "/v1/ns/service", nil, form)
	if err != nil {
		return err
	}
	return parseNamingOKResult(body, status, "nacos.backend.error.service_update_failed")
}

// DeleteService deletes a service (only when instance count is 0 on server side).
func (c *ClientImpl) DeleteService(ctx context.Context, namespaceID, serviceName, groupName string) error {
	serviceName = strings.TrimSpace(serviceName)
	if serviceName == "" {
		return localizedNacosBackendError("nacos.backend.error.service_name_required", nil)
	}
	params := url.Values{}
	params.Set("serviceName", serviceName)
	params.Set("groupName", normalizeServiceGroup(groupName))
	params.Set("namespaceId", normalizeNamespaceID(namespaceID))
	body, status, err := c.doRequest(ctx, http.MethodDelete, "/v1/ns/service", params, nil)
	if err != nil {
		return err
	}
	return parseNamingOKResult(body, status, "nacos.backend.error.service_delete_failed")
}

// ListInstances lists instances for a service.
func (c *ClientImpl) ListInstances(ctx context.Context, query InstanceQuery) (*InstanceList, error) {
	serviceName := strings.TrimSpace(query.ServiceName)
	if serviceName == "" {
		return nil, localizedNacosBackendError("nacos.backend.error.service_name_required", nil)
	}
	params := url.Values{}
	params.Set("serviceName", serviceName)
	params.Set("groupName", normalizeServiceGroup(query.GroupName))
	params.Set("namespaceId", normalizeNamespaceID(query.NamespaceID))
	if clusters := strings.TrimSpace(query.Clusters); clusters != "" {
		params.Set("clusters", clusters)
	}
	if query.HealthyOnly {
		params.Set("healthyOnly", "true")
	}

	body, status, err := c.doRequest(ctx, http.MethodGet, "/v1/ns/instance/list", params, nil)
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
		Name        string `json:"name"`
		GroupName   string `json:"groupName"`
		Clusters    string `json:"clusters"`
		CacheMillis int64  `json:"cacheMillis"`
		Hosts       []struct {
			InstanceID  string            `json:"instanceId"`
			IP          string            `json:"ip"`
			Port        int               `json:"port"`
			Weight      float64           `json:"weight"`
			Healthy     bool              `json:"healthy"`
			Enabled     bool              `json:"enabled"`
			Ephemeral   bool              `json:"ephemeral"`
			ClusterName string            `json:"clusterName"`
			ServiceName string            `json:"serviceName"`
			Metadata    map[string]string `json:"metadata"`
		} `json:"hosts"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, localizedNacosBackendError("nacos.backend.error.parse_instances", map[string]any{
			"detail": err.Error(),
		})
	}

	hosts := make([]Instance, 0, len(payload.Hosts))
	for _, host := range payload.Hosts {
		hosts = append(hosts, Instance{
			InstanceID:  strings.TrimSpace(host.InstanceID),
			IP:          strings.TrimSpace(host.IP),
			Port:        host.Port,
			Weight:      host.Weight,
			Healthy:     host.Healthy,
			Enabled:     host.Enabled,
			Ephemeral:   host.Ephemeral,
			ClusterName: strings.TrimSpace(host.ClusterName),
			ServiceName: firstNonEmpty(strings.TrimSpace(host.ServiceName), serviceName),
			Metadata:    host.Metadata,
		})
	}
	return &InstanceList{
		Name:        firstNonEmpty(strings.TrimSpace(payload.Name), serviceName),
		GroupName:   firstNonEmpty(strings.TrimSpace(payload.GroupName), normalizeServiceGroup(query.GroupName)),
		Clusters:    strings.TrimSpace(payload.Clusters),
		CacheMillis: payload.CacheMillis,
		Hosts:       hosts,
	}, nil
}

// GetInstance loads one instance detail.
func (c *ClientImpl) GetInstance(ctx context.Context, req InstanceRequest) (*Instance, error) {
	if err := validateInstanceIdentity(req); err != nil {
		return nil, err
	}
	params := buildInstanceParams(req, false)
	body, status, err := c.doRequest(ctx, http.MethodGet, "/v1/ns/instance", params, nil)
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
		InstanceID  string            `json:"instanceId"`
		IP          string            `json:"ip"`
		Port        int               `json:"port"`
		Weight      float64           `json:"weight"`
		Healthy     bool              `json:"healthy"`
		Enabled     bool              `json:"enabled"`
		Ephemeral   bool              `json:"ephemeral"`
		ClusterName string            `json:"clusterName"`
		Service     string            `json:"service"`
		ServiceName string            `json:"serviceName"`
		Metadata    map[string]string `json:"metadata"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, localizedNacosBackendError("nacos.backend.error.parse_instance", map[string]any{
			"detail": err.Error(),
		})
	}
	return &Instance{
		InstanceID:  strings.TrimSpace(payload.InstanceID),
		IP:          firstNonEmpty(strings.TrimSpace(payload.IP), strings.TrimSpace(req.IP)),
		Port:        firstNonZeroPort(payload.Port, req.Port),
		Weight:      payload.Weight,
		Healthy:     payload.Healthy,
		Enabled:     payload.Enabled,
		Ephemeral:   payload.Ephemeral,
		ClusterName: firstNonEmpty(strings.TrimSpace(payload.ClusterName), strings.TrimSpace(req.ClusterName)),
		ServiceName: firstNonEmpty(strings.TrimSpace(payload.ServiceName), strings.TrimSpace(payload.Service), strings.TrimSpace(req.ServiceName)),
		Metadata:    payload.Metadata,
	}, nil
}

// RegisterInstance registers an instance.
func (c *ClientImpl) RegisterInstance(ctx context.Context, req InstanceRequest) error {
	if err := validateInstanceIdentity(req); err != nil {
		return err
	}
	form := buildInstanceForm(req, true)
	body, status, err := c.doRequest(ctx, http.MethodPost, "/v1/ns/instance", nil, form)
	if err != nil {
		return err
	}
	return parseNamingOKResult(body, status, "nacos.backend.error.instance_register_failed")
}

// UpdateInstance updates an instance.
func (c *ClientImpl) UpdateInstance(ctx context.Context, req InstanceRequest) error {
	if err := validateInstanceIdentity(req); err != nil {
		return err
	}
	form := buildInstanceForm(req, true)
	body, status, err := c.doRequest(ctx, http.MethodPut, "/v1/ns/instance", nil, form)
	if err != nil {
		return err
	}
	return parseNamingOKResult(body, status, "nacos.backend.error.instance_update_failed")
}

// DeregisterInstance removes an instance.
func (c *ClientImpl) DeregisterInstance(ctx context.Context, req InstanceRequest) error {
	if err := validateInstanceIdentity(req); err != nil {
		return err
	}
	params := buildInstanceParams(req, true)
	body, status, err := c.doRequest(ctx, http.MethodDelete, "/v1/ns/instance", params, nil)
	if err != nil {
		return err
	}
	return parseNamingOKResult(body, status, "nacos.backend.error.instance_deregister_failed")
}

// UpdateInstanceHealth updates instance health (only when health checker is NONE).
func (c *ClientImpl) UpdateInstanceHealth(ctx context.Context, req InstanceRequest) error {
	if err := validateInstanceIdentity(req); err != nil {
		return err
	}
	if req.Healthy == nil {
		return localizedNacosBackendError("nacos.backend.error.instance_healthy_required", nil)
	}
	form := buildInstanceForm(req, false)
	form.Set("healthy", strconv.FormatBool(*req.Healthy))
	body, status, err := c.doRequest(ctx, http.MethodPut, "/v1/ns/health/instance", nil, form)
	if err != nil {
		return err
	}
	return parseNamingOKResult(body, status, "nacos.backend.error.instance_health_failed")
}

func validateInstanceIdentity(req InstanceRequest) error {
	if strings.TrimSpace(req.ServiceName) == "" {
		return localizedNacosBackendError("nacos.backend.error.service_name_required", nil)
	}
	if strings.TrimSpace(req.IP) == "" {
		return localizedNacosBackendError("nacos.backend.error.instance_ip_required", nil)
	}
	if req.Port <= 0 || req.Port > 65535 {
		return localizedNacosBackendError("nacos.backend.error.instance_port_invalid", nil)
	}
	return nil
}

func buildInstanceParams(req InstanceRequest, includeEphemeral bool) url.Values {
	params := url.Values{}
	params.Set("serviceName", strings.TrimSpace(req.ServiceName))
	params.Set("groupName", normalizeServiceGroup(req.GroupName))
	params.Set("namespaceId", normalizeNamespaceID(req.NamespaceID))
	params.Set("ip", strings.TrimSpace(req.IP))
	params.Set("port", strconv.Itoa(req.Port))
	if cluster := strings.TrimSpace(req.ClusterName); cluster != "" {
		params.Set("clusterName", cluster)
		params.Set("cluster", cluster)
	}
	if includeEphemeral && req.Ephemeral != nil {
		params.Set("ephemeral", strconv.FormatBool(*req.Ephemeral))
	}
	return params
}

func buildInstanceForm(req InstanceRequest, includeAttrs bool) url.Values {
	form := buildInstanceParams(req, true)
	if includeAttrs {
		if req.Weight > 0 {
			form.Set("weight", strconv.FormatFloat(req.Weight, 'f', -1, 64))
		}
		if req.Enabled != nil {
			form.Set("enabled", strconv.FormatBool(*req.Enabled))
		}
		if req.Healthy != nil {
			form.Set("healthy", strconv.FormatBool(*req.Healthy))
		}
		if meta := encodeMetadata(req.Metadata); meta != "" {
			form.Set("metadata", meta)
		}
	}
	return form
}

func normalizeServiceGroup(group string) string {
	group = strings.TrimSpace(group)
	if group == "" {
		return defaultServiceGroup
	}
	return group
}

func encodeMetadata(metadata map[string]string) string {
	if len(metadata) == 0 {
		return ""
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return ""
	}
	return string(raw)
}

func parseNamingOKResult(body []byte, status int, failKey string) error {
	if status < 200 || status >= 300 {
		return localizedNacosBackendError("nacos.backend.error.http_status", map[string]any{
			"status": status,
			"body":   truncateForError(string(body)),
		})
	}
	text := strings.TrimSpace(string(body))
	if text == "" || strings.EqualFold(text, "ok") || text == "true" {
		return nil
	}
	var boolResult bool
	if err := json.Unmarshal(body, &boolResult); err == nil && boolResult {
		return nil
	}
	return localizedNacosBackendError(failKey, map[string]any{
		"body": truncateForError(text),
	})
}

func firstNonZeroPort(values ...int) int {
	for _, v := range values {
		if v > 0 {
			return v
		}
	}
	return 0
}
