package market

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/url"
	"time"
)

// webStart begins the browser login flow. The return target travels in a
// short-lived HttpOnly cookie rather than in OAuth state, so the state value
// stays a pure anti-forgery nonce.
func (s *Server) webStart(w http.ResponseWriter, r *http.Request) {
	if s.identity == nil {
		redirectLogin(w, r, "auth_unavailable")
		return
	}
	returnTo := browserReturnTo(r.URL.Query().Get("returnTo"))
	state, err := newSecret(32)
	if err != nil {
		writeError(w, err)
		return
	}
	verifier, err := newSecret(32)
	if err != nil {
		writeError(w, err)
		return
	}
	flow := AuthFlow{Hash: secretHash(state), Kind: "oauth", Verifier: verifier, ExpiresAt: s.now().Add(10 * time.Minute)}
	if err = s.repo.CreateFlow(r.Context(), flow); err != nil {
		writeError(w, err)
		return
	}
	challenge := sha256.Sum256([]byte(verifier))
	s.setBrowserFlowCookie(w, browserStateCookie, state, 600)
	s.setBrowserFlowCookie(w, browserReturnCookie, url.QueryEscape(returnTo), 600)
	http.Redirect(w, r, s.identity.AuthorizeURL(state, base64.RawURLEncoding.EncodeToString(challenge[:])), http.StatusSeeOther)
}

// webCallback completes the login, issues one revocable session, and returns
// the browser to the validated post-login path. Failures stay navigations so a
// human sees the login page instead of raw JSON.
func (s *Server) webCallback(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	if !browserCookieMatches(r, browserStateCookie, state) {
		redirectLogin(w, r, "invalid_oauth_state")
		return
	}
	returnTo := s.browserReturnTarget(r)
	s.setBrowserFlowCookie(w, browserStateCookie, "", -1)
	s.setBrowserFlowCookie(w, browserReturnCookie, "", -1)
	if s.identity == nil {
		redirectLogin(w, r, "auth_unavailable")
		return
	}
	flow, err := s.repo.ConsumeFlow(r.Context(), secretHash(state), "oauth", s.now())
	if err != nil {
		redirectLogin(w, r, "invalid_oauth_state")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" || len(code) > 4096 {
		redirectLogin(w, r, "oauth_denied")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	identity, err := s.identity.Exchange(ctx, code, flow.Verifier)
	if err != nil {
		redirectLogin(w, r, "identity_provider_failed")
		return
	}
	account, err := s.repo.UpsertIdentity(ctx, identity)
	if err != nil {
		redirectLogin(w, r, "identity_provider_failed")
		return
	}
	token, err := newSecret(32)
	if err != nil {
		writeError(w, err)
		return
	}
	if err = s.repo.CreateSession(ctx, secretHash(token), account.ID, s.webSessionExpiry()); err != nil {
		writeError(w, err)
		return
	}
	s.setSessionCookie(w, token, browserSessionAge)
	http.Redirect(w, r, returnTo, http.StatusSeeOther)
}
