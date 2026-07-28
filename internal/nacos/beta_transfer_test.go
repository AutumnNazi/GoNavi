package nacos

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestPublishBetaAndStopBeta(t *testing.T) {
	var publishForm url.Values
	var stopPath string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/v1/console/namespaces"):
			_, _ = io.WriteString(w, `{"code":200,"data":[]}`)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/v1/cs/configs"):
			_ = r.ParseForm()
			publishForm = r.Form
			_, _ = io.WriteString(w, "true")
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/v1/cs/configs"):
			if r.URL.Query().Get("beta") == "true" {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"dataId":  "app.yaml",
					"group":   "DEFAULT_GROUP",
					"content": "beta-content",
					"betaIps": "10.0.0.1,10.0.0.2",
					"type":    "yaml",
					"md5":     ContentMD5("beta-content"),
				})
				return
			}
			http.NotFound(w, r)
		case r.Method == http.MethodDelete && strings.HasSuffix(r.URL.Path, "/v1/cs/configs/beta"):
			stopPath = r.URL.Path
			_, _ = io.WriteString(w, "true")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	u, _ := url.Parse(server.URL)
	port, _ := strconv.Atoi(u.Port())
	client := NewClient()
	if err := client.Connect(connection.ConnectionConfig{
		Type: "nacos", Host: u.Hostname(), Port: port, Timeout: 5,
		ConnectionParams: "contextPath=/",
	}); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	if err := client.PublishConfig(ctx, PublishRequest{
		NamespaceID: "dev",
		DataID:      "app.yaml",
		Group:       "DEFAULT_GROUP",
		Content:     "beta-content",
		Type:        "yaml",
		BetaIPs:     "10.0.0.1,10.0.0.2",
	}); err != nil {
		t.Fatalf("Publish beta: %v", err)
	}
	if publishForm.Get("betaIps") != "10.0.0.1,10.0.0.2" {
		t.Fatalf("publish form = %#v", publishForm)
	}

	beta, err := client.GetBetaConfig(ctx, "dev", "DEFAULT_GROUP", "app.yaml")
	if err != nil {
		t.Fatalf("GetBetaConfig: %v", err)
	}
	if !beta.Exists || beta.Content != "beta-content" || beta.BetaIPs == "" {
		t.Fatalf("beta = %#v", beta)
	}

	if err := client.StopBetaConfig(ctx, "dev", "DEFAULT_GROUP", "app.yaml"); err != nil {
		t.Fatalf("StopBetaConfig: %v", err)
	}
	if !strings.HasSuffix(stopPath, "/v1/cs/configs/beta") {
		t.Fatalf("stop path = %q", stopPath)
	}
}

func TestTransferFileRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nacos-export.json")
	payload := NewTransferFile("dev", "development")
	payload.Configs = []TransferConfigEntry{
		{DataID: "a.yaml", Group: "DEFAULT_GROUP", Content: "x: 1", Type: "yaml"},
		{DataID: "b.properties", Group: "G1", Content: "k=v", Type: "properties"},
	}
	if err := WriteTransferFile(path, payload); err != nil {
		t.Fatalf("WriteTransferFile: %v", err)
	}
	loaded, err := ReadTransferFile(path)
	if err != nil {
		t.Fatalf("ReadTransferFile: %v", err)
	}
	if loaded.Format != TransferFileFormat || len(loaded.Configs) != 2 {
		t.Fatalf("loaded = %#v", loaded)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}
