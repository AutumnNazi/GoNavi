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

func TestNormalizeNamespaceID(t *testing.T) {
	t.Parallel()
	if got := normalizeNamespaceID("public"); got != "" {
		t.Fatalf("public should map to empty tenant, got %q", got)
	}
	if got := normalizeNamespaceID("  dev  "); got != "dev" {
		t.Fatalf("unexpected namespace id: %q", got)
	}
}

func TestResolveNacosContextPath(t *testing.T) {
	t.Parallel()
	if got := resolveNacosContextPath(connection.ConnectionConfig{}); got != "/nacos" {
		t.Fatalf("default context path = %q", got)
	}
	if got := resolveNacosContextPath(connection.ConnectionConfig{
		ConnectionParams: "contextPath=/custom-nacos",
	}); got != "/custom-nacos" {
		t.Fatalf("custom context path = %q", got)
	}
}

func TestClientConfigFlow(t *testing.T) {
	var (
		gotLoginUser string
		gotPublish   url.Values
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/v1/auth/login"):
			_ = r.ParseForm()
			gotLoginUser = r.Form.Get("username")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"accessToken": "token-1",
				"tokenTtl":    3600,
			})
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/v1/console/namespaces"):
			if r.URL.Query().Get("accessToken") != "token-1" {
				http.Error(w, "missing token", http.StatusForbidden)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 200,
				"data": []map[string]any{
					{"namespace": "", "namespaceShowName": "public", "configCount": 2},
					{"namespace": "dev-id", "namespaceShowName": "dev", "configCount": 1},
				},
			})
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/v1/cs/configs"):
			if r.URL.Query().Get("search") != "" {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"totalCount":     1,
					"pageNumber":     1,
					"pagesAvailable": 1,
					"pageItems": []map[string]any{
						{
							"dataId": "app.yaml",
							"group":  "DEFAULT_GROUP",
							"type":   "yaml",
							"md5":    "abc",
							"tenant": "dev-id",
						},
					},
				})
				return
			}
			if r.URL.Query().Get("dataId") == "app.yaml" {
				_, _ = io.WriteString(w, "server:\n  port: 8080\n")
				return
			}
			http.NotFound(w, r)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/v1/cs/configs"):
			_ = r.ParseForm()
			gotPublish = r.Form
			_, _ = io.WriteString(w, "true")
		case r.Method == http.MethodDelete && strings.HasSuffix(r.URL.Path, "/v1/cs/configs"):
			_, _ = io.WriteString(w, "true")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	host := u.Hostname()
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatal(err)
	}

	client := NewClient()
	cfg := connection.ConnectionConfig{
		Type:             "nacos",
		Host:             host,
		Port:             port,
		User:             "nacos",
		Password:         "nacos",
		Timeout:          5,
		ConnectionParams: "contextPath=/",
	}
	if err := client.Connect(cfg); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer client.Close()

	if gotLoginUser != "nacos" {
		t.Fatalf("login user = %q", gotLoginUser)
	}

	ctx := context.Background()
	namespaces, err := client.ListNamespaces(ctx)
	if err != nil {
		t.Fatalf("ListNamespaces: %v", err)
	}
	if len(namespaces) != 2 {
		t.Fatalf("namespaces len = %d", len(namespaces))
	}
	if namespaces[0].ShowName != "public" || namespaces[0].ID != "" {
		t.Fatalf("public namespace = %#v", namespaces[0])
	}

	page, err := client.SearchConfigs(ctx, ConfigQuery{
		NamespaceID: "dev-id",
		DataID:      "app",
		PageNo:      1,
		PageSize:    10,
	})
	if err != nil {
		t.Fatalf("SearchConfigs: %v", err)
	}
	if page.TotalCount != 1 || len(page.PageItems) != 1 || page.PageItems[0].DataID != "app.yaml" {
		t.Fatalf("unexpected page: %#v", page)
	}

	detail, err := client.GetConfig(ctx, "dev-id", "DEFAULT_GROUP", "app.yaml")
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if !strings.Contains(detail.Content, "port: 8080") {
		t.Fatalf("content = %q", detail.Content)
	}

	if err := client.PublishConfig(ctx, PublishRequest{
		NamespaceID: "dev-id",
		DataID:      "app.yaml",
		Group:       "DEFAULT_GROUP",
		Content:     "server:\n  port: 9090\n",
		Type:        "yaml",
	}); err != nil {
		t.Fatalf("PublishConfig: %v", err)
	}
	if gotPublish.Get("dataId") != "app.yaml" || gotPublish.Get("tenant") != "dev-id" {
		t.Fatalf("publish form = %#v", gotPublish)
	}

	if err := client.DeleteConfig(ctx, "dev-id", "DEFAULT_GROUP", "app.yaml"); err != nil {
		t.Fatalf("DeleteConfig: %v", err)
	}
}

func TestClientNamespaceAndHistory(t *testing.T) {
	var (
		createdForm url.Values
		updatedForm url.Values
		deletedForm url.Values
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/v1/console/namespaces"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 200,
				"data": []map[string]any{
					{"namespace": "", "namespaceShowName": "public"},
				},
			})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/v1/console/namespaces"):
			_ = r.ParseForm()
			createdForm = r.Form
			_, _ = io.WriteString(w, "true")
		case r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/v1/console/namespaces"):
			_ = r.ParseForm()
			updatedForm = r.Form
			_, _ = io.WriteString(w, "true")
		case r.Method == http.MethodDelete && strings.HasSuffix(r.URL.Path, "/v1/console/namespaces"):
			deletedForm = r.URL.Query()
			_, _ = io.WriteString(w, "true")
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/v1/cs/history"):
			if r.URL.Query().Get("search") == "accurate" {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"totalCount":     1,
					"pageNumber":     1,
					"pagesAvailable": 1,
					"pageItems": []map[string]any{
						{
							"id":               "203",
							"dataId":           "app.yaml",
							"group":            "DEFAULT_GROUP",
							"tenant":           "dev-id",
							"opType":           "U",
							"lastModifiedTime": "2026-07-28T01:00:00.000+0000",
						},
					},
				})
				return
			}
			if r.URL.Query().Get("nid") == "203" {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"id":      "203",
					"dataId":  "app.yaml",
					"group":   "DEFAULT_GROUP",
					"tenant":  "dev-id",
					"content": "old-content",
					"md5":     "md5-old",
				})
				return
			}
			http.NotFound(w, r)
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
	if err := client.CreateNamespace(ctx, CreateNamespaceRequest{
		ID:          "dev-id",
		ShowName:    "dev",
		Description: "development",
	}); err != nil {
		t.Fatalf("CreateNamespace: %v", err)
	}
	if createdForm.Get("customNamespaceId") != "dev-id" || createdForm.Get("namespaceName") != "dev" {
		t.Fatalf("create form = %#v", createdForm)
	}

	if err := client.UpdateNamespace(ctx, UpdateNamespaceRequest{
		ID:          "dev-id",
		ShowName:    "dev2",
		Description: "updated",
	}); err != nil {
		t.Fatalf("UpdateNamespace: %v", err)
	}
	if updatedForm.Get("namespace") != "dev-id" || updatedForm.Get("namespaceShowName") != "dev2" {
		t.Fatalf("update form = %#v", updatedForm)
	}

	if err := client.DeleteNamespace(ctx, "public"); err == nil {
		t.Fatal("expected public delete to fail")
	}
	if err := client.DeleteNamespace(ctx, "dev-id"); err != nil {
		t.Fatalf("DeleteNamespace: %v", err)
	}
	if deletedForm.Get("namespaceId") != "dev-id" {
		t.Fatalf("delete form = %#v", deletedForm)
	}

	page, err := client.ListConfigHistory(ctx, HistoryQuery{
		NamespaceID: "dev-id",
		DataID:      "app.yaml",
		Group:       "DEFAULT_GROUP",
	})
	if err != nil {
		t.Fatalf("ListConfigHistory: %v", err)
	}
	if page.TotalCount != 1 || len(page.PageItems) != 1 || page.PageItems[0].ID != "203" {
		t.Fatalf("history page = %#v", page)
	}

	detail, err := client.GetConfigHistory(ctx, "dev-id", "DEFAULT_GROUP", "app.yaml", "203")
	if err != nil {
		t.Fatalf("GetConfigHistory: %v", err)
	}
	if detail.Content != "old-content" {
		t.Fatalf("history detail = %#v", detail)
	}
}
