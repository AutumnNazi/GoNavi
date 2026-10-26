package market

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// identityFixture is the injected GitHub identity provider used by every login
// test; the real provider performs network calls and is exercised separately.
type identityFixture struct{ fail bool }

func (i identityFixture) AuthorizeURL(state, challenge string) string {
	return "https://github.example/authorize?" + url.Values{"state": {state}, "code_challenge": {challenge}}.Encode()
}

func (i identityFixture) Exchange(ctx context.Context, code, verifier string) (Identity, error) {
	if i.fail || code != "provider-code" || len(verifier) != 43 {
		return Identity{}, errors.New("identity exchange rejected")
	}
	return Identity{ID: "42", Login: "new-user"}, nil
}

// browserRequest sends one request with optional cookies, mimicking a browser
// that carries HttpOnly flow cookies but no Authorization header.
func browserRequest(f *httpFixture, method, path string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "http://localhost:8090/api/v1"+path, nil)
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, request)
	return response
}

func responseCookie(t *testing.T, response *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}

// browserSessionFor pre-issues one browser session and its derived CSRF token.
func browserSessionFor(t *testing.T, f *httpFixture, accountID string) (*http.Cookie, string) {
	t.Helper()
	token, err := newSecret(32)
	if err != nil {
		t.Fatal(err)
	}
	f.repo.mu.Lock()
	f.repo.sessions[secretHash(token)] = testSession{accountID: accountID, expires: time.Now().Add(time.Hour)}
	f.repo.mu.Unlock()
	return &http.Cookie{Name: "gonavi_market_session", Value: token, Path: "/"}, csrfToken(token)
}

func startWebLogin(t *testing.T, f *httpFixture, returnTo string) (*httptest.ResponseRecorder, string, *http.Cookie) {
	t.Helper()
	start := browserRequest(f, "GET", "/auth/web/start?returnTo="+url.QueryEscape(returnTo))
	assertStatus(t, start, 303)
	target, err := url.Parse(start.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	state := target.Query().Get("state")
	if len(state) != 43 || target.Query().Get("code_challenge") == "" {
		t.Fatalf("start response lacks state or PKCE: %s", target)
	}
	stateCookie := responseCookie(t, start, "gonavi_market_oauth")
	if stateCookie == nil || stateCookie.Value != state {
		t.Fatal("missing state cookie")
	}
	return start, state, stateCookie
}

type webSessionBody struct {
	Authenticated bool    `json:"authenticated"`
	Account       Account `json:"account"`
	CSRFToken     string  `json:"csrfToken"`
}

func TestWebSessionAbsentReturnsAuthenticatedFalse(t *testing.T) {
	f := newHTTPFixture(t)
	response := browserRequest(f, "GET", "/auth/web/session")
	assertStatus(t, response, 200)
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["authenticated"] != false {
		t.Fatalf("body=%v", body)
	}
	if _, ok := body["account"]; ok {
		t.Fatal("absent session leaked an account")
	}
	stale := &http.Cookie{Name: "gonavi_market_session", Value: strings.Repeat("s", 43), Path: "/"}
	response = browserRequest(f, "GET", "/auth/web/session", stale)
	assertStatus(t, response, 200)
	if !strings.Contains(response.Body.String(), `"authenticated":false`) {
		t.Fatalf("unknown cookie authenticated: %s", response.Body.String())
	}
}

func TestWebLoginCallbackSessionCSRFAndLogout(t *testing.T) {
	f := newHTTPFixture(t)
	f.server.identity = identityFixture{}
	start, state, stateCookie := startWebLogin(t, f, "/publish")
	returnCookie := responseCookie(t, start, "gonavi_market_web_return")
	if returnCookie == nil {
		t.Fatal("missing returnTo cookie")
	}
	callback := browserRequest(f, "GET", "/auth/github/callback?code=provider-code&state="+state, stateCookie, returnCookie)
	assertStatus(t, callback, 303)
	if location := callback.Header().Get("Location"); location != "/publish" {
		t.Fatalf("returnTo=%q", location)
	}
	session := responseCookie(t, callback, "gonavi_market_session")
	if session == nil || len(session.Value) != 43 || !session.HttpOnly || session.Path != "/" || session.MaxAge != 86400 {
		t.Fatalf("invalid session cookie: %+v", session)
	}
	body := decodeResponse[webSessionBody](t, browserRequest(f, "GET", "/auth/web/session", session))
	if !body.Authenticated || body.Account.Login != "new-user" || body.Account.ID != "42" {
		t.Fatalf("session=%+v", body)
	}
	if body.CSRFToken != csrfToken(session.Value) || len(body.CSRFToken) != 43 {
		t.Fatal("csrf token is not derived from the session token")
	}
	missing := httptest.NewRequest("POST", "http://localhost:8090/api/v1/auth/web/logout", nil)
	missing.AddCookie(session)
	missingResponse := httptest.NewRecorder()
	f.handler.ServeHTTP(missingResponse, missing)
	assertStatus(t, missingResponse, 403)
	if failure := decodeResponse[APIError](t, missingResponse); failure.Code != "invalid_csrf" {
		t.Fatalf("failure=%+v", failure)
	}
	wrong := httptest.NewRequest("POST", "http://localhost:8090/api/v1/auth/web/logout", nil)
	wrong.AddCookie(session)
	wrong.Header.Set("X-GoNavi-CSRF", strings.Repeat("x", 43))
	wrongResponse := httptest.NewRecorder()
	f.handler.ServeHTTP(wrongResponse, wrong)
	assertStatus(t, wrongResponse, 403)

	logout := httptest.NewRequest("POST", "http://localhost:8090/api/v1/auth/web/logout", nil)
	logout.AddCookie(session)
	logout.Header.Set("X-GoNavi-CSRF", body.CSRFToken)
	logoutResponse := httptest.NewRecorder()
	f.handler.ServeHTTP(logoutResponse, logout)
	assertStatus(t, logoutResponse, 200)
	if !strings.Contains(logoutResponse.Body.String(), `"revoked":true`) {
		t.Fatalf("body=%s", logoutResponse.Body.String())
	}
	cleared := responseCookie(t, logoutResponse, "gonavi_market_session")
	if cleared == nil || cleared.MaxAge >= 0 {
		t.Fatal("session cookie was not cleared")
	}
	if after := decodeResponse[webSessionBody](t, browserRequest(f, "GET", "/auth/web/session", session)); after.Authenticated {
		t.Fatal("revoked session still authenticates")
	}
}

func TestWebCallbackStateAndDenialFailures(t *testing.T) {
	f := newHTTPFixture(t)
	f.server.identity = identityFixture{}
	wrongState := browserRequest(f, "GET", "/auth/github/callback?code=provider-code&state="+strings.Repeat("q", 43),
		&http.Cookie{Name: "gonavi_market_oauth", Value: strings.Repeat("q", 43), Path: "/"})
	assertStatus(t, wrongState, 303)
	if location := wrongState.Header().Get("Location"); location != "/login?error=invalid_oauth_state" {
		t.Fatalf("location=%q", location)
	}
	_, state, stateCookie := startWebLogin(t, f, "/publish")
	denied := browserRequest(f, "GET", "/auth/github/callback?state="+state, stateCookie)
	assertStatus(t, denied, 303)
	if location := denied.Header().Get("Location"); location != "/login?error=oauth_denied" {
		t.Fatalf("location=%q", location)
	}
	replay := browserRequest(f, "GET", "/auth/github/callback?code=provider-code&state="+state, stateCookie)
	assertStatus(t, replay, 303)
	if location := replay.Header().Get("Location"); location != "/login?error=invalid_oauth_state" {
		t.Fatalf("replay location=%q", location)
	}
	if responseCookie(t, replay, "gonavi_market_session") != nil {
		t.Fatal("failed callback issued a session")
	}
}

func TestWebCallbackProviderFailureAndUnavailable(t *testing.T) {
	f := newHTTPFixture(t)
	f.server.identity = identityFixture{fail: true}
	_, state, stateCookie := startWebLogin(t, f, "/publish")
	failed := browserRequest(f, "GET", "/auth/github/callback?code=provider-code&state="+state, stateCookie)
	assertStatus(t, failed, 303)
	if location := failed.Header().Get("Location"); location != "/login?error=identity_provider_failed" {
		t.Fatalf("location=%q", location)
	}
	if responseCookie(t, failed, "gonavi_market_session") != nil {
		t.Fatal("failed identity issued a session")
	}
	offline := newHTTPFixture(t)
	start := browserRequest(offline, "GET", "/auth/web/start?returnTo=/publish")
	assertStatus(t, start, 303)
	if location := start.Header().Get("Location"); location != "/login?error=auth_unavailable" {
		t.Fatalf("location=%q", location)
	}
}

func TestWebReturnToValidation(t *testing.T) {
	cases := map[string]string{
		"/publish":                      "/publish",
		"/account/plugins/acme.example": "/account/plugins/acme.example",
		"//evil.example/steal":          "/account",
		"https://evil.example/steal":    "/account",
		"/ok\\..\\evil":                 "/account",
		"javascript:alert(1)":           "/account",
		"":                              "/account",
	}
	for returnTo, want := range cases {
		t.Run(returnTo, func(t *testing.T) {
			f := newHTTPFixture(t)
			f.server.identity = identityFixture{}
			start := browserRequest(f, "GET", "/auth/web/start?returnTo="+url.QueryEscape(returnTo))
			assertStatus(t, start, 303)
			stateCookie := responseCookie(t, start, "gonavi_market_oauth")
			returnCookie := responseCookie(t, start, "gonavi_market_web_return")
			if stateCookie == nil || returnCookie == nil {
				t.Fatalf("missing flow cookies for %q", returnTo)
			}
			callback := browserRequest(f, "GET", "/auth/github/callback?code=provider-code&state="+stateCookie.Value, stateCookie, returnCookie)
			assertStatus(t, callback, 303)
			if location := callback.Header().Get("Location"); location != want {
				t.Fatalf("returnTo=%q location=%q want=%q", returnTo, location, want)
			}
		})
	}
}

func TestWebSessionRejectsExpiredCookie(t *testing.T) {
	f := newHTTPFixture(t)
	token, err := newSecret(32)
	if err != nil {
		t.Fatal(err)
	}
	f.repo.mu.Lock()
	f.repo.sessions[secretHash(token)] = testSession{accountID: "1", expires: time.Now().Add(-time.Minute)}
	f.repo.mu.Unlock()
	cookie := &http.Cookie{Name: "gonavi_market_session", Value: token, Path: "/"}
	body := decodeResponse[webSessionBody](t, browserRequest(f, "GET", "/auth/web/session", cookie))
	if body.Authenticated {
		t.Fatal("expired cookie authenticated")
	}
}

func TestBrowserSessionCookieNamingFollowsPublicURL(t *testing.T) {
	f := newHTTPFixture(t)
	if name := f.server.browserSessionCookie(); name != "gonavi_market_session" {
		t.Fatalf("local name=%q", name)
	}
	secure, err := NewServer(ServerOptions{Repository: f.repo, Artifacts: f.server.artifacts, PublicURL: "https://plugin.example"})
	if err != nil {
		t.Fatal(err)
	}
	if name := secure.browserSessionCookie(); name != "__Host-gonavi_market_session" || !secure.secure {
		t.Fatalf("secure name=%q", name)
	}
}

func TestRemovedDeviceAndAliasRoutesAreGone(t *testing.T) {
	f := newHTTPFixture(t)
	for _, route := range []struct{ method, path string }{
		{"POST", "/auth/device"},
		{"POST", "/auth/device/token"},
		{"POST", "/auth/device/decision"},
		{"GET", "/auth/device"},
		{"GET", "/auth/github"},
		{"GET", "/auth/web/callback"},
	} {
		response := f.request(route.method, route.path, "", nil)
		assertStatus(t, response, 404)
		if failure := decodeResponse[APIError](t, response); failure.Code != "not_found" {
			t.Fatalf("%s %s failure=%+v", route.method, route.path, failure)
		}
	}
}

func TestOperatorTokenSessionAndLogout(t *testing.T) {
	f := newHTTPFixture(t)
	token, err := newSecret(32)
	if err != nil {
		t.Fatal(err)
	}
	if err = f.repo.CreateSession(context.Background(), secretHash(token), "2", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	f.tokens["operator"] = token
	account := decodeResponse[Account](t, f.request("GET", "/auth/session", "operator", nil))
	if account.ID != "2" || account.Role != "admin" || account.Login != "reviewer" {
		t.Fatalf("account=%+v", account)
	}
	assertStatus(t, f.request("POST", "/auth/logout", "operator", nil), 200)
	assertStatus(t, f.request("GET", "/auth/session", "operator", nil), 401)
}
