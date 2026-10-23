package market

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

type githubResponseFailure struct {
	name   string
	status int
	body   string
}

func githubTokenFailures() []githubResponseFailure {
	return []githubResponseFailure{
		{name: "denied", status: http.StatusOK, body: `{"error":"bad_verification_code","error_description":"gho_testPrivateToken"}`},
		{name: "error with valid token", status: http.StatusOK, body: `{"error":"denied","access_token":"gho_testPrivateToken","token_type":"bearer"}`},
		{name: "null error with valid token", status: http.StatusOK, body: `{"error":null,"access_token":"gho_testPrivateToken","token_type":"bearer"}`},
		{name: "empty object", status: http.StatusOK, body: `{}`},
		{name: "missing token", status: http.StatusOK, body: `{"token_type":"bearer"}`},
		{name: "empty token", status: http.StatusOK, body: `{"access_token":"","token_type":"bearer"}`},
		{name: "numeric token", status: http.StatusOK, body: `{"access_token":123,"token_type":"bearer"}`},
		{name: "missing token type", status: http.StatusOK, body: `{"access_token":"gho_testPrivateToken"}`},
		{name: "wrong token type", status: http.StatusOK, body: `{"access_token":"gho_testPrivateToken","token_type":"basic"}`},
		{name: "non-string token type", status: http.StatusOK, body: `{"access_token":"gho_testPrivateToken","token_type":123}`},
		{name: "token whitespace", status: http.StatusOK, body: `{"access_token":"bad token","token_type":"bearer"}`},
		{name: "token header injection", status: http.StatusOK, body: `{"access_token":"gho_testPrivateToken\r\nX-Injected: true","token_type":"bearer"}`},
		{name: "non-ASCII token", status: http.StatusOK, body: `{"access_token":"token\u00e9","token_type":"bearer"}`},
		{name: "token invalid padding", status: http.StatusOK, body: `{"access_token":"bad=padding","token_type":"bearer"}`},
		{name: "token only padding", status: http.StatusOK, body: `{"access_token":"==","token_type":"bearer"}`},
		{name: "malformed JSON", status: http.StatusOK, body: `{"access_token":"gho_testPrivateToken"`},
		{name: "multiple JSON values", status: http.StatusOK, body: githubTestTokenJSON + `{}`},
		{name: "form response", status: http.StatusOK, body: "access_token=gho_testPrivateToken&token_type=bearer"},
		{name: "array", status: http.StatusOK, body: `[]`},
		{name: "null", status: http.StatusOK, body: `null`},
		{name: "empty body", status: http.StatusOK},
		{name: "created", status: http.StatusCreated, body: githubTestTokenJSON},
		{name: "unauthorized", status: http.StatusUnauthorized, body: githubTestTokenJSON},
		{name: "rate limited", status: http.StatusTooManyRequests, body: githubTestTokenJSON},
		{name: "upstream failure", status: http.StatusBadGateway, body: githubTestClientSecret},
	}
}

func githubIdentityFailures() []githubResponseFailure {
	return []githubResponseFailure{
		{name: "missing ID", status: http.StatusOK, body: `{"login":"octocat"}`},
		{name: "zero ID", status: http.StatusOK, body: `{"id":0,"login":"octocat"}`},
		{name: "negative ID", status: http.StatusOK, body: `{"id":-1,"login":"octocat"}`},
		{name: "fractional ID", status: http.StatusOK, body: `{"id":1.5,"login":"octocat"}`},
		{name: "exponent ID", status: http.StatusOK, body: `{"id":1e3,"login":"octocat"}`},
		{name: "string ID", status: http.StatusOK, body: `{"id":"583231","login":"octocat"}`},
		{name: "null ID", status: http.StatusOK, body: `{"id":null,"login":"octocat"}`},
		{name: "boolean ID", status: http.StatusOK, body: `{"id":true,"login":"octocat"}`},
		{name: "overflow ID", status: http.StatusOK, body: `{"id":18446744073709551616,"login":"octocat"}`},
		{name: "missing login", status: http.StatusOK, body: `{"id":583231}`},
		{name: "empty login", status: http.StatusOK, body: `{"id":583231,"login":""}`},
		{name: "blank login", status: http.StatusOK, body: `{"id":583231,"login":" \t"}`},
		{name: "whitespace login", status: http.StatusOK, body: `{"id":583231,"login":"octo cat"}`},
		{name: "padded login", status: http.StatusOK, body: `{"id":583231,"login":" octocat"}`},
		{name: "unicode whitespace login", status: http.StatusOK, body: `{"id":583231,"login":"octo\u00a0cat"}`},
		{name: "control character login", status: http.StatusOK, body: `{"id":583231,"login":"octo\u0000cat"}`},
		{name: "non-string login", status: http.StatusOK, body: `{"id":583231,"login":123}`},
		{name: "null login", status: http.StatusOK, body: `{"id":583231,"login":null}`},
		{name: "malformed JSON", status: http.StatusOK, body: `{"id":583231,"login":"gho_testPrivateToken"`},
		{name: "multiple JSON values", status: http.StatusOK, body: githubTestIdentityJSON + `{}`},
		{name: "array", status: http.StatusOK, body: `[]`},
		{name: "null", status: http.StatusOK, body: `null`},
		{name: "empty body", status: http.StatusOK},
		{name: "created", status: http.StatusCreated, body: githubTestIdentityJSON},
		{name: "unauthorized", status: http.StatusUnauthorized, body: githubTestToken},
		{name: "forbidden", status: http.StatusForbidden, body: githubTestClientSecret},
		{name: "upstream failure", status: http.StatusServiceUnavailable, body: githubTestClientSecret},
	}
}

func TestGitHubExchangeRejectsResponses(t *testing.T) {
	for _, stage := range []struct {
		name     string
		failures []githubResponseFailure
	}{
		{name: "token", failures: githubTokenFailures()},
		{name: "identity", failures: githubIdentityFailures()},
	} {
		t.Run(stage.name, func(t *testing.T) {
			for _, tt := range stage.failures {
				t.Run(tt.name, func(t *testing.T) {
					var identityCalls atomic.Int32
					provider := newGitHubTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
						if r.URL.Path == "/token" {
							if stage.name == "token" {
								writeGitHubTestResponse(t, w, tt.status, tt.body)
								return
							}
							writeGitHubTestResponse(t, w, http.StatusOK, githubTestTokenJSON)
							return
						}
						identityCalls.Add(1)
						writeGitHubTestResponse(t, w, tt.status, tt.body)
					})
					identity, err := provider.Exchange(context.Background(), githubTestCode, githubTestVerifier)
					assertGitHubFailure(t, identity, err)
					if stage.name == "token" && identityCalls.Load() != 0 {
						t.Fatal("identity fetched after token exchange failed")
					}
				})
			}
		})
	}
}

func TestGitHubExchangeResponseBodyLimits(t *testing.T) {
	for _, stage := range []string{"token", "identity"} {
		for _, knownLength := range []bool{false, true} {
			for _, extra := range []int{0, 1} {
				name := stage + "/knownLength=" + strconv.FormatBool(knownLength) + "/extra=" + strconv.Itoa(extra)
				t.Run(name, func(t *testing.T) {
					var bodyBytes atomic.Int64
					var readBytes atomic.Int64
					var closes atomic.Int32
					provider := newGitHubTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
						body := githubTestTokenJSON
						currentStage := "token"
						if r.URL.Path == "/user" {
							body, currentStage = githubTestIdentityJSON, "identity"
						}
						if currentStage != stage {
							writeGitHubTestResponse(t, w, http.StatusOK, body)
							return
						}
						body += strings.Repeat(" ", githubMaxBodyBytes-len(body)+extra)
						bodyBytes.Store(int64(len(body)))
						if knownLength {
							w.Header().Set("Content-Length", strconv.Itoa(len(body)))
						} else {
							w.WriteHeader(http.StatusOK)
							w.(http.Flusher).Flush()
						}
						// A client rejecting Content-Length can close before the write finishes.
						if _, err := w.Write([]byte(body)); err != nil && extra == 0 {
							t.Errorf("write full-size valid response: %v", err)
						}
					})
					transport := provider.httpClient.Transport
					provider.httpClient.Transport = githubRoundTripFunc(func(req *http.Request) (*http.Response, error) {
						response, err := transport.RoundTrip(req)
						if err != nil {
							return nil, err
						}
						if stage == "token" && req.URL.Path == "/token" || stage == "identity" && req.URL.Path == "/user" {
							response.Body = &githubTrackingBody{ReadCloser: response.Body, readBytes: &readBytes, closes: &closes}
						}
						return response, nil
					})
					identity, err := provider.Exchange(context.Background(), githubTestCode, githubTestVerifier)
					if closes.Load() != 1 || readBytes.Load() > githubMaxBodyBytes+1 {
						t.Fatalf("body not bounded and closed: reads=%d, closes=%d", readBytes.Load(), closes.Load())
					}
					if bodyBytes.Load() != int64(githubMaxBodyBytes+extra) {
						t.Fatal("test did not exercise the body size boundary")
					}
					if extra != 0 {
						assertGitHubFailure(t, identity, err)
						if !strings.Contains(err.Error(), "exceeds 1 MiB") {
							t.Fatalf("unexpected size error: %v", err)
						}
						return
					}
					if err != nil || identity != (Identity{ID: "583231", Login: "octocat"}) {
						t.Fatalf("exactly 1 MiB must succeed: identity=%#v, err=%v", identity, err)
					}
				})
			}
		}
	}
}

func TestGitHubExchangeTruncatedBodies(t *testing.T) {
	for _, stage := range []string{"token", "identity"} {
		t.Run(stage, func(t *testing.T) {
			provider := newGitHubTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/token" && stage == "identity" {
					writeGitHubTestResponse(t, w, http.StatusOK, githubTestTokenJSON)
					return
				}
				w.Header().Set("Content-Length", "4096")
				writeGitHubTestResponse(t, w, http.StatusOK, githubTestTokenJSON)
			})
			identity, err := provider.Exchange(context.Background(), githubTestCode, githubTestVerifier)
			assertGitHubFailure(t, identity, err)
			if !strings.Contains(err.Error(), "request failed") {
				t.Fatalf("truncated body must fail reading: %v", err)
			}
		})
	}
}
