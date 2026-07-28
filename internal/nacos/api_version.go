package nacos

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

type nacosAPIFamily uint8

const (
	nacosAPIUnknown nacosAPIFamily = iota
	nacosAPIV1
	nacosAPIV2
	nacosAPIV3
)

type nacosAPIRoutes struct {
	namespaceList      string
	namespace          string
	config             string
	configList         string
	configHistory      string
	historyList        string
	beta               string
	service            string
	serviceList        string
	serviceListByGroup string
	instance           string
	instanceList       string
	health             string
}

func routesForNacosAPI(family nacosAPIFamily) nacosAPIRoutes {
	switch family {
	case nacosAPIV3:
		return nacosAPIRoutes{
			namespaceList:      "/v3/admin/core/namespace/list",
			namespace:          "/v3/admin/core/namespace",
			config:             "/v3/admin/cs/config",
			configList:         "/v3/admin/cs/config/list",
			configHistory:      "/v3/admin/cs/history",
			historyList:        "/v3/admin/cs/history/list",
			beta:               "/v3/admin/cs/config/beta",
			service:            "/v3/admin/ns/service",
			serviceList:        "/v3/admin/ns/service/list",
			serviceListByGroup: "/v3/admin/ns/service/list",
			instance:           "/v3/admin/ns/instance",
			instanceList:       "/v3/admin/ns/instance/list",
			health:             "/v3/admin/ns/health/instance",
		}
	case nacosAPIV2:
		return nacosAPIRoutes{
			namespaceList: "/v2/console/namespace/list",
			namespace:     "/v2/console/namespace",
			config:        "/v2/cs/config",
			configList:    "/v2/cs/config/searchDetail",
			configHistory: "/v2/cs/history",
			historyList:   "/v2/cs/history/list",
			// Nacos 2.x has no v2 beta query/stop endpoint.
			beta:               "/v1/cs/configs",
			service:            "/v2/ns/service",
			serviceList:        "/v2/ns/service/list",
			serviceListByGroup: "/v2/ns/service/list",
			instance:           "/v2/ns/instance",
			instanceList:       "/v2/ns/instance/list",
			health:             "/v2/ns/health/instance",
		}
	default:
		return nacosAPIRoutes{
			namespaceList:      "/v1/console/namespaces",
			namespace:          "/v1/console/namespaces",
			config:             "/v1/cs/configs",
			configList:         "/v1/cs/configs",
			configHistory:      "/v1/cs/history",
			historyList:        "/v1/cs/history",
			beta:               "/v1/cs/configs",
			service:            "/v1/ns/service",
			serviceList:        "/v1/ns/catalog/services",
			serviceListByGroup: "/v1/ns/service/list",
			instance:           "/v1/ns/instance",
			instanceList:       "/v1/ns/instance/list",
			health:             "/v1/ns/health/instance",
		}
	}
}

func (c *ClientImpl) currentAPIFamily() nacosAPIFamily {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.apiFamily == nacosAPIUnknown {
		return nacosAPIV1
	}
	return c.apiFamily
}

func (c *ClientImpl) currentAPIRoutes() nacosAPIRoutes {
	return routesForNacosAPI(c.currentAPIFamily())
}

func (c *ClientImpl) detectAPIFamily(ctx context.Context) error {
	probes := []struct {
		family nacosAPIFamily
		path   string
	}{
		{family: nacosAPIV3, path: routesForNacosAPI(nacosAPIV3).namespaceList},
		{family: nacosAPIV2, path: routesForNacosAPI(nacosAPIV2).namespaceList},
		{family: nacosAPIV1, path: routesForNacosAPI(nacosAPIV1).namespaceList},
	}

	for _, probe := range probes {
		body, status, err := c.doRequest(ctx, http.MethodGet, probe.path, nil, nil)
		if err != nil {
			return err
		}
		if status >= 200 && status < 300 {
			if err := validateNacosAPIProbe(body); err != nil {
				return err
			}
			c.mu.Lock()
			c.apiFamily = probe.family
			c.mu.Unlock()
			return nil
		}
		if isMissingNacosAPI(status, body) {
			continue
		}
		return nacosHTTPStatusError(status, body)
	}

	return nacosHTTPStatusError(http.StatusNotFound, []byte("no supported Nacos API family found"))
}

func validateNacosAPIProbe(body []byte) error {
	var envelope struct {
		Code    *int            `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || envelope.Code == nil {
		detail := "response is not a Nacos API result"
		if err != nil {
			detail = err.Error()
		}
		return localizedNacosBackendError("nacos.backend.error.parse_namespaces", map[string]any{
			"detail": detail,
		})
	}
	if *envelope.Code != 0 && *envelope.Code != 200 {
		return localizedNacosBackendError("nacos.backend.error.api_code", map[string]any{
			"code":    *envelope.Code,
			"message": strings.TrimSpace(envelope.Message),
		})
	}
	return nil
}

func isMissingNacosAPI(status int, body []byte) bool {
	if status == http.StatusNotFound || status == http.StatusMethodNotAllowed {
		return true
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return false
	}
	text := strings.ToLower(strings.TrimSpace(string(body)))
	return strings.Contains(text, "no such api") ||
		strings.Contains(text, "no handler found") ||
		strings.Contains(text, "api not found")
}

func nacosHTTPStatusError(status int, body []byte) error {
	return localizedNacosBackendError("nacos.backend.error.http_status", map[string]any{
		"status": status,
		"body":   truncateForError(string(body)),
	})
}

// unwrapNacosResult extracts data from the Result<T> envelope used by Nacos
// v2/v3 and several v1 console endpoints. Raw v1 payloads pass through.
func unwrapNacosResult(body []byte) ([]byte, error) {
	var envelope struct {
		Code    *int            `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || envelope.Code == nil {
		return body, nil
	}
	if *envelope.Code != 0 && *envelope.Code != 200 {
		return nil, localizedNacosBackendError("nacos.backend.error.api_code", map[string]any{
			"code":    *envelope.Code,
			"message": strings.TrimSpace(envelope.Message),
		})
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil, nil
	}
	return envelope.Data, nil
}
