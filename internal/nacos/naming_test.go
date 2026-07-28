package nacos

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestNamingServiceAndInstanceFlow(t *testing.T) {
	var (
		createServiceForm url.Values
		registerForm      url.Values
		healthForm        url.Values
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/v1/console/namespaces"):
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": []any{}})
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/v1/ns/service/list"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"count": 2,
				"doms":  []string{"orders", "DEFAULT_GROUP@@payments"},
			})
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/v1/ns/service"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"name":             "orders",
				"groupName":        "DEFAULT_GROUP",
				"namespaceId":      "dev",
				"protectThreshold": 0.5,
				"metadata":         map[string]string{"owner": "team-a"},
				"clusters": []map[string]any{
					{"name": "DEFAULT"},
				},
			})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/v1/ns/service"):
			_ = r.ParseForm()
			createServiceForm = r.Form
			_, _ = io.WriteString(w, "ok")
		case r.Method == http.MethodDelete && strings.HasSuffix(r.URL.Path, "/v1/ns/service"):
			_, _ = io.WriteString(w, "ok")
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/v1/ns/instance/list"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"name":      "DEFAULT_GROUP@@orders",
				"groupName": "DEFAULT_GROUP",
				"hosts": []map[string]any{
					{
						"ip":          "10.0.0.1",
						"port":        8080,
						"weight":      1,
						"healthy":     true,
						"enabled":     true,
						"ephemeral":   true,
						"clusterName": "DEFAULT",
						"serviceName": "DEFAULT_GROUP@@orders",
						"metadata":    map[string]string{"zone": "a"},
					},
				},
			})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/v1/ns/instance"):
			_ = r.ParseForm()
			registerForm = r.Form
			_, _ = io.WriteString(w, "ok")
		case r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/v1/ns/health/instance"):
			_ = r.ParseForm()
			healthForm = r.Form
			_, _ = io.WriteString(w, "ok")
		case r.Method == http.MethodDelete && strings.HasSuffix(r.URL.Path, "/v1/ns/instance"):
			_, _ = io.WriteString(w, "ok")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatal(err)
	}

	client := NewClient()
	if err := client.Connect(connection.ConnectionConfig{
		Type:             "nacos",
		Host:             u.Hostname(),
		Port:             port,
		Timeout:          5,
		ConnectionParams: "contextPath=/",
	}); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	page, err := client.ListServices(ctx, ServiceQuery{NamespaceID: "dev", PageNo: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("ListServices: %v", err)
	}
	if page.Count != 2 || len(page.ServiceNames) != 2 {
		t.Fatalf("service page = %#v", page)
	}

	detail, err := client.GetService(ctx, "dev", "orders", "DEFAULT_GROUP")
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	if detail.Name != "orders" || detail.ProtectThreshold != 0.5 {
		t.Fatalf("service detail = %#v", detail)
	}

	if err := client.CreateService(ctx, CreateServiceRequest{
		NamespaceID: "dev",
		ServiceName: "cart",
		GroupName:   "DEFAULT_GROUP",
		Metadata:    map[string]string{"env": "dev"},
	}); err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if createServiceForm.Get("serviceName") != "cart" {
		t.Fatalf("create form = %#v", createServiceForm)
	}

	list, err := client.ListInstances(ctx, InstanceQuery{
		NamespaceID: "dev",
		ServiceName: "orders",
		GroupName:   "DEFAULT_GROUP",
	})
	if err != nil {
		t.Fatalf("ListInstances: %v", err)
	}
	if len(list.Hosts) != 1 || list.Hosts[0].IP != "10.0.0.1" {
		t.Fatalf("instances = %#v", list)
	}

	ephemeral := true
	enabled := true
	if err := client.RegisterInstance(ctx, InstanceRequest{
		NamespaceID: "dev",
		ServiceName: "orders",
		GroupName:   "DEFAULT_GROUP",
		IP:          "10.0.0.2",
		Port:        8081,
		Weight:      1,
		Enabled:     &enabled,
		Ephemeral:   &ephemeral,
		ClusterName: "DEFAULT",
	}); err != nil {
		t.Fatalf("RegisterInstance: %v", err)
	}
	if registerForm.Get("ip") != "10.0.0.2" || registerForm.Get("port") != "8081" {
		t.Fatalf("register form = %#v", registerForm)
	}

	healthy := false
	if err := client.UpdateInstanceHealth(ctx, InstanceRequest{
		NamespaceID: "dev",
		ServiceName: "orders",
		IP:          "10.0.0.1",
		Port:        8080,
		Healthy:     &healthy,
	}); err != nil {
		t.Fatalf("UpdateInstanceHealth: %v", err)
	}
	if healthForm.Get("healthy") != "false" {
		t.Fatalf("health form = %#v", healthForm)
	}

	if err := client.DeregisterInstance(ctx, InstanceRequest{
		NamespaceID: "dev",
		ServiceName: "orders",
		IP:          "10.0.0.2",
		Port:        8081,
	}); err != nil {
		t.Fatalf("DeregisterInstance: %v", err)
	}

	if err := client.DeleteService(ctx, "dev", "cart", "DEFAULT_GROUP"); err != nil {
		t.Fatalf("DeleteService: %v", err)
	}
}
