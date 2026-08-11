package mcpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseHTTPServerOptionsSupportsFlagsAndEnvFallback(t *testing.T) {
	t.Setenv("GONAVI_MCP_HTTP_ADDR", "127.0.0.1:9000")
	t.Setenv("GONAVI_MCP_HTTP_PATH", "/env-mcp")
	t.Setenv("GONAVI_MCP_HTTP_TOKEN", "env-token")

	options, err := ParseHTTPServerOptions([]string{
		"--addr", "127.0.0.1:8765",
		"--path", "mcp",
		"--token", "flag-token",
		"--schema-only",
		"--json-response=false",
	})
	if err != nil {
		t.Fatalf("ParseHTTPServerOptions returned error: %v", err)
	}
	normalized, err := normalizeHTTPServerOptions(options)
	if err != nil {
		t.Fatalf("normalizeHTTPServerOptions returned error: %v", err)
	}

	if normalized.Addr != "127.0.0.1:8765" {
		t.Fatalf("expected addr from flag, got %q", normalized.Addr)
	}
	if normalized.Path != "/mcp" {
		t.Fatalf("expected normalized path /mcp, got %q", normalized.Path)
	}
	if normalized.Token != "flag-token" {
		t.Fatalf("expected token from flag, got %q", normalized.Token)
	}
	if normalized.JSONResponse {
		t.Fatal("expected json response flag to be false")
	}
	if !normalized.SchemaOnly {
		t.Fatal("expected schema-only flag to be true")
	}
}

func TestNormalizeHTTPServerOptionsRejectsNonLoopbackAddresses(t *testing.T) {
	for _, addr := range []string{"0.0.0.0:8765", ":8765", "192.0.2.10:8765", "[::]:8765"} {
		if _, err := normalizeHTTPServerOptions(HTTPServerOptions{Addr: addr, Path: "/mcp", Token: "secret"}); err == nil {
			t.Fatalf("normalizeHTTPServerOptions(%q) unexpectedly succeeded", addr)
		}
	}
	for _, addr := range []string{"127.0.0.1:8765", "localhost:8765", "[::1]:8765"} {
		if _, err := normalizeHTTPServerOptions(HTTPServerOptions{Addr: addr, Path: "/mcp", Token: "secret"}); err != nil {
			t.Fatalf("normalizeHTTPServerOptions(%q) returned error: %v", addr, err)
		}
	}
}

func TestNormalizeHTTPServerOptionsRequiresBearerToken(t *testing.T) {
	_, err := normalizeHTTPServerOptions(HTTPServerOptions{Addr: "127.0.0.1:8765", Path: "/mcp"})
	if err == nil || !strings.Contains(err.Error(), "bearer token") {
		t.Fatalf("expected missing bearer token error, got %v", err)
	}
}

func TestBearerTokenAuthHandlerRejectsMissingOrWrongToken(t *testing.T) {
	called := false
	handler := bearerTokenAuthHandler("secret-token", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/mcp", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected missing token to return 401, got %d", recorder.Code)
	}
	if called {
		t.Fatal("next handler should not be called without token")
	}

	recorder = httptest.NewRecorder()
	wrongReq := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	wrongReq.Header.Set("Authorization", "Bearer wrong")
	handler.ServeHTTP(recorder, wrongReq)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected wrong token to return 401, got %d", recorder.Code)
	}
	if called {
		t.Fatal("next handler should not be called with wrong token")
	}

	recorder = httptest.NewRecorder()
	validReq := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	validReq.Header.Set("Authorization", "Bearer secret-token")
	handler.ServeHTTP(recorder, validReq)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected valid token to pass, got %d", recorder.Code)
	}
	if !called {
		t.Fatal("next handler should be called with valid token")
	}
}
