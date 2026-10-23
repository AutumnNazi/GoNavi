package nativewindow

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestPluginChildOptionsAreHostOwnedAndLoopbackOnly(t *testing.T) {
	profile, err := os.MkdirTemp(t.TempDir(), "gonavi-plugin-window-")
	if err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]string{"ENDPOINT": "http://127.0.0.1:4321", "TOKEN": strings.Repeat("a", 43), "ID": strings.Repeat("b", 43), "PROFILE": profile, "PARENT_PID": strconv.Itoa(os.Getpid()), "WIDTH": "960", "HEIGHT": "720"} {
		t.Setenv(pluginEnvPrefix+key, value)
	}
	if _, err := parsePluginChildOptions(nil); err != nil {
		t.Fatal(err)
	}
	if _, err := parsePluginChildOptions([]string{"--token", "shared-token"}); err == nil {
		t.Fatal("CLI override accepted")
	}
	for _, endpoint := range []string{"http://example.com:4321", "https://127.0.0.1:4321", "http://127.0.0.1:4321/path", "http://user@127.0.0.1:4321", "http://127.0.0.1:4321?redirect=x", "http://localhost:4321"} {
		t.Setenv(pluginEnvPrefix+"ENDPOINT", endpoint)
		if _, err := parsePluginChildOptions(nil); err == nil {
			t.Fatalf("unsafe endpoint accepted: %s", endpoint)
		}
	}
}

func TestPluginChildProxyDoesNotForwardMainRoutesOrCredentials(t *testing.T) {
	requests := 0
	parent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get(pluginTokenHeader) != "child-token" || r.Header.Get(pluginWindowHeader) != "child-id" {
			t.Error("wrong capability")
		}
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("forwarded unrelated credentials")
		}
		w.WriteHeader(204)
	}))
	defer parent.Close()
	proxy := newPluginChildProxy(pluginChildOptions{endpoint: parent.URL, token: "child-token", id: "child-id"}, http.DefaultTransport)
	for _, path := range []string{InvokePath, "/wails/ipc", "/frontend/index.html"} {
		request := httptest.NewRequest(http.MethodGet, "http://wails.local"+path, nil)
		response := httptest.NewRecorder()
		proxy.ServeHTTP(response, request)
		if response.Code != 404 {
			t.Fatal("main route allowed")
		}
	}
	if requests != 0 {
		t.Fatal("main RPC reached parent")
	}
	request := httptest.NewRequest(http.MethodPost, "http://wails.local"+pluginBridgePrefix+"heartbeat", strings.NewReader(`{"sequence":1}`))
	request.Header.Set(pluginTokenHeader, "attacker")
	request.Header.Set("Authorization", "main-secret")
	request.Header.Set("Cookie", "host-session=secret")
	response := httptest.NewRecorder()
	proxy.ServeHTTP(response, request)
	if response.Code != 204 || requests != 1 {
		t.Fatal("scoped proxy failed")
	}
}

func TestPluginChildClosingUsesOnlyHostState(t *testing.T) {
	parent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != pluginBridgePrefix+"state" {
			t.Error("child used heartbeat to fake JS health")
		}
		if _, err := io.WriteString(w, `{"closing":true}`); err != nil {
			t.Error(err)
		}
	}))
	defer parent.Close()
	closing, err := pluginChildClosing(t.Context(), parent.Client(), pluginChildOptions{endpoint: parent.URL})
	if err != nil || !closing {
		t.Fatalf("closing=%v err=%v", closing, err)
	}
}
