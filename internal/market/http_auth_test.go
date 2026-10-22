package market

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

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

func authRequest(f *httpFixture, method, path, form string, cookie *http.Cookie) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "http://localhost:8090/api/v1"+path, strings.NewReader(form))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, request)
	return response
}

func oauthConsent(t *testing.T, f *httpFixture, challenge DeviceAuthorization) *http.Cookie {
	t.Helper()
	start := authRequest(f, "GET", "/auth/github?user_code="+challenge.UserCode, "", nil)
	assertStatus(t, start, 303)
	target, err := url.Parse(start.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if target.Query().Get("code_challenge") == "" {
		t.Fatal("missing PKCE")
	}
	state := target.Query().Get("state")
	cookie := start.Result().Cookies()[0]
	callback := authRequest(f, "GET", "/auth/github/callback?code=provider-code&state="+state, "", cookie)
	assertStatus(t, callback, 200)
	if !strings.Contains(callback.Body.String(), challenge.UserCode) {
		t.Fatal("device code absent from consent")
	}
	replay := authRequest(f, "GET", "/auth/github/callback?code=provider-code&state="+state, "", cookie)
	assertStatus(t, replay, 400)
	for _, c := range callback.Result().Cookies() {
		if c.Name == "gonavi_market_consent" {
			return c
		}
	}
	t.Fatal("missing consent cookie")
	return nil
}

func TestDeviceOAuthConsentPollSessionAndRevocation(t *testing.T) {
	f := newHTTPFixture(t)
	f.server.identity = identityFixture{}
	now := time.Now()
	f.server.now = func() time.Time { return now }
	start := f.request("POST", "/auth/device", "", nil)
	assertStatus(t, start, 201)
	challenge := decodeResponse[DeviceAuthorization](t, start)
	if challenge.IntervalSeconds != 5 || challenge.ExpiresIn != 600 || challenge.VerificationURI != "http://localhost:8090/api/v1/auth/device" {
		t.Fatalf("challenge=%+v", challenge)
	}
	pollBody := `{"deviceCode":"` + challenge.DeviceCode + `"}`
	pending := decodeResponse[DeviceToken](t, f.request("POST", "/auth/device/token", "", strings.NewReader(pollBody)))
	if pending.Status != "pending" || pending.AccessToken != "" {
		t.Fatal("authorization fabricated")
	}
	assertStatus(t, f.request("POST", "/auth/device/token", "", strings.NewReader(pollBody)), 429)
	consent := oauthConsent(t, f, challenge)
	bad := authRequest(f, "POST", "/auth/device/decision", "nonce=wrong&decision=approve", consent)
	assertStatus(t, bad, 403)
	decision := url.Values{"nonce": {consent.Value}, "decision": {"approve"}}.Encode()
	assertStatus(t, authRequest(f, "POST", "/auth/device/decision", decision, consent), 200)
	assertStatus(t, authRequest(f, "POST", "/auth/device/decision", decision, consent), 401)
	now = now.Add(5 * time.Second)
	response := f.request("POST", "/auth/device/token", "", strings.NewReader(pollBody))
	assertStatus(t, response, 200)
	token := decodeResponse[DeviceToken](t, response)
	if token.Status != "authorized" || token.ExpiresIn != 86400 || len(token.AccessToken) != 43 {
		t.Fatalf("token=%+v", token)
	}
	f.tokens["new"] = token.AccessToken
	account := decodeResponse[Account](t, f.request("GET", "/auth/session", "new", nil))
	if account.Role != "user" || account.Official || account.PublisherID != "" {
		t.Fatal("new user received privileges")
	}
	replay := decodeResponse[DeviceToken](t, f.request("POST", "/auth/device/token", "", strings.NewReader(pollBody)))
	if replay.Status != "expired" || replay.AccessToken != "" {
		t.Fatal("device token replayed")
	}
	assertStatus(t, f.request("POST", "/auth/logout", "new", nil), 200)
	assertStatus(t, f.request("GET", "/auth/session", "new", nil), 401)
}

func TestDeviceDeniedExpiredAndUnavailable(t *testing.T) {
	for _, decision := range []string{"deny", "expire"} {
		t.Run(decision, func(t *testing.T) {
			f := newHTTPFixture(t)
			f.server.identity = identityFixture{}
			now := time.Now()
			f.server.now = func() time.Time { return now }
			challenge := decodeResponse[DeviceAuthorization](t, f.request("POST", "/auth/device", "", nil))
			if decision == "deny" {
				cookie := oauthConsent(t, f, challenge)
				assertStatus(t, authRequest(f, "POST", "/auth/device/decision", url.Values{"nonce": {cookie.Value}, "decision": {"deny"}}.Encode(), cookie), 200)
			} else {
				now = now.Add(11 * time.Minute)
			}
			response := decodeResponse[DeviceToken](t, f.request("POST", "/auth/device/token", "", strings.NewReader(`{"deviceCode":"`+challenge.DeviceCode+`"}`)))
			expected := "denied"
			if decision == "expire" {
				expected = "expired"
			}
			if response.Status != expected || response.AccessToken != "" {
				t.Fatalf("response=%+v", response)
			}
		})
	}
	f := newHTTPFixture(t)
	assertStatus(t, f.request("POST", "/auth/device", "", nil), 503)
	assertStatus(t, authRequest(f, "GET", "/auth/github/callback?code=fake&state=fake", "", nil), 503)
}

func TestOAuthFailureNeverCreatesSession(t *testing.T) {
	f := newHTTPFixture(t)
	f.server.identity = identityFixture{fail: true}
	challenge := decodeResponse[DeviceAuthorization](t, f.request("POST", "/auth/device", "", nil))
	start := authRequest(f, "GET", "/auth/github?user_code="+challenge.UserCode, "", nil)
	target, err := url.Parse(start.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	path := "/auth/github/callback?code=provider-code&state=" + target.Query().Get("state")
	assertStatus(t, authRequest(f, "GET", path, "", nil), 400)
	assertStatus(t, authRequest(f, "GET", path, "", start.Result().Cookies()[0]), 502)
	if _, ok := f.repo.accounts["42"]; ok {
		t.Fatal("failed identity created account")
	}
}
