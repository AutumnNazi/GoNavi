package nacos

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
)

func TestContentMD5(t *testing.T) {
	t.Parallel()
	// md5("hello") = 5d41402abc4b2a76b9719d911017c592
	if got := ContentMD5("hello"); got != "5d41402abc4b2a76b9719d911017c592" {
		t.Fatalf("md5 = %q", got)
	}
}

func TestParseListenResponse(t *testing.T) {
	t.Parallel()
	raw := "app.yaml" + string(byte(2)) + "DEFAULT_GROUP" + string(byte(2)) + "dev-id" + string(byte(1))
	got := parseListenResponse(raw)
	if len(got) != 1 || got[0].DataID != "app.yaml" || got[0].NamespaceID != "dev-id" {
		t.Fatalf("parsed = %#v", got)
	}
	if len(parseListenResponse("")) != 0 {
		t.Fatal("empty response should be no change")
	}
}

func TestListenOnceChanged(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/v1/console/namespaces"):
			_, _ = io.WriteString(w, `{"code":200,"data":[]}`)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/v1/cs/configs/listener"):
			if r.Header.Get("Long-Pulling-Timeout") == "" {
				t.Errorf("missing Long-Pulling-Timeout")
			}
			_ = r.ParseForm()
			listening := r.Form.Get("Listening-Configs")
			if !strings.Contains(listening, "app.yaml") {
				t.Errorf("listening packet = %q", listening)
			}
			// changed packet
			_, _ = io.WriteString(w, "app.yaml"+string(byte(2))+"DEFAULT_GROUP"+string(byte(2))+"dev"+string(byte(1)))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	port, _ := strconv.Atoi(u.Port())
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

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	changed, err := client.ListenOnce(ctx, []ConfigListenTarget{{
		NamespaceID: "dev",
		DataID:      "app.yaml",
		Group:       "DEFAULT_GROUP",
		ContentMD5:  ContentMD5("old"),
	}}, 5000)
	if err != nil {
		t.Fatalf("ListenOnce: %v", err)
	}
	if len(changed) != 1 || changed[0].DataID != "app.yaml" {
		t.Fatalf("changed = %#v", changed)
	}
}
