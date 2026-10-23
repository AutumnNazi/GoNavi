package market

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"
)

const (
	githubTestClientID     = "test-client+id"
	githubTestClientSecret = "test-secret&private"
	githubTestCallback     = "https://market.example.test/auth/callback?mode=login"
	githubTestCode         = "test-code+&="
	githubTestVerifier     = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	githubTestChallenge    = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
	githubTestToken        = "gho_testPrivateToken"
	githubTestTokenJSON    = `{"access_token":"gho_testPrivateToken","token_type":"bearer","scope":""}`
	githubTestIdentityJSON = `{"id":583231,"login":"octocat","email":"ignored@example.test"}`
)

func githubTestConfig() GitHubConfig {
	return GitHubConfig{
		ClientID:     githubTestClientID,
		ClientSecret: githubTestClientSecret,
		CallbackURL:  githubTestCallback,
	}
}

func newGitHubTestProvider(t *testing.T, handler http.HandlerFunc) *GitHubProvider {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	config := githubTestConfig()
	config.HTTPClient = server.Client()
	provider, err := NewGitHubProvider(config)
	if err != nil {
		t.Fatal(err)
	}
	provider.authorizeURL = server.URL + "/authorize"
	provider.tokenURL = server.URL + "/token"
	provider.userURL = server.URL + "/user"
	return provider
}

func assertGitHubFailure(t *testing.T, identity Identity, err error, sensitive ...string) {
	t.Helper()
	if err == nil || identity != (Identity{}) {
		t.Fatalf("failed exchange returned identity=%#v, err=%v", identity, err)
	}
	for _, value := range append(sensitive, githubTestClientSecret, githubTestCode, githubTestVerifier, githubTestToken) {
		if strings.Contains(err.Error(), value) {
			t.Fatalf("error disclosed sensitive fixture %q", value)
		}
	}
}

func TestNewGitHubProvider(t *testing.T) {
	tests := []struct {
		name     string
		id       string
		secret   string
		callback string
		valid    bool
	}{
		{name: "https", id: "id", secret: "secret", callback: githubTestCallback, valid: true},
		{name: "localhost", id: "id", secret: "secret", callback: "http://localhost:8080/callback", valid: true},
		{name: "IPv4 loopback", id: "id", secret: "secret", callback: "http://127.0.0.1:8080/callback", valid: true},
		{name: "IPv6 loopback", id: "id", secret: "secret", callback: "http://[::1]:8080/callback", valid: true},
		{name: "empty client ID", secret: "secret", callback: githubTestCallback},
		{name: "blank client ID", id: " \t", secret: "secret", callback: githubTestCallback},
		{name: "empty client secret", id: "id", callback: githubTestCallback},
		{name: "blank client secret", id: "id", secret: " \t", callback: githubTestCallback},
		{name: "empty callback", id: "id", secret: "secret"},
		{name: "relative callback", id: "id", secret: "secret", callback: "/callback"},
		{name: "HTTP remote", id: "id", secret: "secret", callback: "http://example.test/callback"},
		{name: "loopback lookalike", id: "id", secret: "secret", callback: "http://localhost.example.test/callback"},
		{name: "userinfo", id: "id", secret: "secret", callback: "https://user:sensitive-marker@example.test/callback"},
		{name: "fragment", id: "id", secret: "secret", callback: "https://example.test/callback#sensitive-marker"},
		{name: "empty fragment", id: "id", secret: "secret", callback: "https://example.test/callback#"},
		{name: "malformed", id: "id", secret: "secret", callback: "https://example.test/%sensitive-marker"},
		{name: "opaque", id: "id", secret: "secret", callback: "https:callback"},
		{name: "missing host", id: "id", secret: "secret", callback: "https:///callback"},
		{name: "unsupported scheme", id: "id", secret: "secret", callback: "file://example.test/callback"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider, err := NewGitHubProvider(GitHubConfig{ClientID: tt.id, ClientSecret: tt.secret, CallbackURL: tt.callback})
			if tt.valid {
				if err != nil || provider == nil {
					t.Fatalf("valid configuration: provider=%v, err=%v", provider, err)
				}
				return
			}
			if err == nil || provider != nil {
				t.Fatalf("invalid configuration: provider=%v, err=%v", provider, err)
			}
			if strings.Contains(err.Error(), "sensitive-marker") {
				t.Fatal("configuration error disclosed callback data")
			}
		})
	}
}

func TestGitHubProviderClientPolicy(t *testing.T) {
	for _, timeout := range []time.Duration{0, -time.Second, time.Minute, time.Second} {
		t.Run(timeout.String(), func(t *testing.T) {
			jar, err := cookiejar.New(nil)
			if err != nil {
				t.Fatal(err)
			}
			redirectCalled := false
			source := &http.Client{Timeout: timeout, Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error {
				redirectCalled = true
				return nil
			}}
			config := githubTestConfig()
			config.HTTPClient = source
			provider, err := NewGitHubProvider(config)
			if err != nil {
				t.Fatal(err)
			}
			if source == provider.httpClient || source.Timeout != timeout || source.Jar != jar || provider.httpClient.Jar != nil {
				t.Fatal("provider must copy the client and remove its cookie jar")
			}
			wantTimeout := timeout
			if timeout <= 0 || timeout > githubHTTPTimeout {
				wantTimeout = githubHTTPTimeout
			}
			if provider.httpClient.Timeout != wantTimeout {
				t.Fatalf("timeout=%s, want %s", provider.httpClient.Timeout, wantTimeout)
			}
			if provider.httpClient.CheckRedirect(nil, nil) != http.ErrUseLastResponse || redirectCalled {
				t.Fatal("provider must replace the redirect policy")
			}
		})
	}
}

func TestGitHubAuthorizeURL(t *testing.T) {
	provider, err := NewGitHubProvider(githubTestConfig())
	if err != nil {
		t.Fatal(err)
	}
	if provider.tokenURL != "https://github.com/login/oauth/access_token" || provider.userURL != "https://api.github.com/user" {
		t.Fatal("unexpected production endpoints")
	}
	state := "random state+&=?"
	u, err := url.Parse(provider.AuthorizeURL(state, githubTestChallenge))
	if err != nil {
		t.Fatal(err)
	}
	wantQuery := url.Values{
		"client_id": {githubTestClientID}, "redirect_uri": {githubTestCallback},
		"state": {state}, "code_challenge": {githubTestChallenge}, "code_challenge_method": {"S256"}, "scope": {""},
	}
	if u.Scheme != "https" || u.Host != "github.com" || u.Path != "/login/oauth/authorize" || !reflect.DeepEqual(u.Query(), wantQuery) {
		t.Fatalf("unexpected authorization URL: %s", u)
	}
	if strings.Contains(u.String(), githubTestClientSecret) || strings.Contains(u.String(), githubTestVerifier) {
		t.Fatal("authorization URL contains credentials or PKCE verifier")
	}
	for _, tt := range []struct{ state, challenge string }{
		{state: "", challenge: githubTestChallenge}, {state: " \t", challenge: githubTestChallenge},
		{state: state, challenge: ""}, {state: state, challenge: " \t"},
	} {
		if provider.AuthorizeURL(tt.state, tt.challenge) != "" {
			t.Fatal("authorization URL must require state and PKCE")
		}
	}
}

func TestGitHubExchangeSuccess(t *testing.T) {
	for _, tt := range []struct {
		name, id, login, tokenType string
	}{
		{name: "normal", id: "583231", login: "octocat", tokenType: "bearer"},
		{name: "renamed account", id: "583231", login: "renamed-login", tokenType: "Bearer"},
		{name: "integer precision", id: "9007199254740993", login: "octocat", tokenType: "BEARER"},
		{name: "uint64 precision", id: "18446744073709551615", login: "octocat", tokenType: "bearer"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			provider := newGitHubTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.RawQuery != "" || r.Header.Get("Cookie") != "" || r.Header.Get("User-Agent") == "" {
					t.Error("request has query/cookies or lacks user agent")
				}
				switch r.URL.Path {
				case "/token":
					assertGitHubTokenRequest(t, r)
					writeGitHubTestResponse(t, w, http.StatusOK, `{"access_token":"`+githubTestToken+`","token_type":"`+tt.tokenType+`"}`)
				case "/user":
					if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer "+githubTestToken || r.Header.Get("Accept") != "application/vnd.github+json" {
						t.Error("identity request must authenticate with the exchanged token")
					}
					writeGitHubTestResponse(t, w, http.StatusOK, `{"id":`+tt.id+`,"login":"`+tt.login+`","email":"ignored@example.test"}`)
				default:
					t.Errorf("unexpected path %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			})
			identity, err := provider.Exchange(context.Background(), githubTestCode, githubTestVerifier)
			if err != nil || identity != (Identity{ID: tt.id, Login: tt.login}) {
				t.Fatalf("identity=%#v, err=%v", identity, err)
			}
		})
	}
}

func assertGitHubTokenRequest(t *testing.T, r *http.Request) {
	t.Helper()
	if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" || r.Header.Get("Accept") != "application/json" {
		t.Error("token request must POST a form and request JSON")
	}
	if r.Header.Get("Authorization") != "" {
		t.Error("token request must not carry bearer credentials")
	}
	if err := r.ParseForm(); err != nil {
		t.Error(err)
		return
	}
	want := url.Values{
		"client_id": {githubTestClientID}, "client_secret": {githubTestClientSecret}, "redirect_uri": {githubTestCallback},
		"code": {githubTestCode}, "code_verifier": {githubTestVerifier},
	}
	if !reflect.DeepEqual(r.PostForm, want) {
		t.Errorf("unexpected token form: %v", r.PostForm)
	}
}

func writeGitHubTestResponse(t *testing.T, w http.ResponseWriter, status int, body string) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if _, err := w.Write([]byte(body)); err != nil {
		t.Errorf("write test response: %v", err)
	}
}
