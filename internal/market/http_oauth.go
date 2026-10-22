package market

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"strings"
	"time"

	"GoNavi-Wails/internal/logger"
)

func normalizeUserCode(code string) string { return strings.ToUpper(strings.TrimSpace(code)) }

func (s *Server) devicePage(w http.ResponseWriter, r *http.Request) {
	if !s.authAvailable(w) {
		return
	}
	s.renderAuthPage(w, r, deviceHTML, authPageData{})
}

func (s *Server) setAuthCookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/api/v1/auth/", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}

func cookieMatches(r *http.Request, name, value string) bool {
	cookie, err := r.Cookie(name)
	return err == nil && len(value) == 43 && subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(value)) == 1
}

func (s *Server) startOAuth(w http.ResponseWriter, r *http.Request) {
	if !s.authAvailable(w) {
		return
	}
	code := normalizeUserCode(r.URL.Query().Get("user_code"))
	if !userCodePattern.MatchString(code) {
		writeError(w, ErrInvalid)
		return
	}
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
	flow := AuthFlow{Hash: secretHash(state), Kind: "oauth", Verifier: verifier, UserCode: code, ExpiresAt: s.now().Add(10 * time.Minute)}
	if err = s.repo.CreateFlow(r.Context(), flow); err != nil {
		writeError(w, err)
		return
	}
	challenge := sha256.Sum256([]byte(verifier))
	s.setAuthCookie(w, "gonavi_market_oauth", state, 600)
	http.Redirect(w, r, s.identity.AuthorizeURL(state, base64.RawURLEncoding.EncodeToString(challenge[:])), http.StatusSeeOther)
}

func (s *Server) oauthCallback(w http.ResponseWriter, r *http.Request) {
	if !s.authAvailable(w) {
		return
	}
	state := r.URL.Query().Get("state")
	if !cookieMatches(r, "gonavi_market_oauth", state) {
		writeAPIError(w, 400, "invalid_oauth_state")
		return
	}
	s.setAuthCookie(w, "gonavi_market_oauth", "", -1)
	flow, err := s.repo.ConsumeFlow(r.Context(), secretHash(state), "oauth", s.now())
	if err != nil {
		writeAPIError(w, 400, "invalid_oauth_state")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" || len(code) > 4096 {
		if err := s.repo.DecideDevice(r.Context(), secretHash(flow.UserCode), "", false, s.now()); err != nil {
			logger.Warnf("market OAuth denial could not update device grant")
		}
		writeAPIError(w, 401, "oauth_denied")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	identity, err := s.identity.Exchange(ctx, code, flow.Verifier)
	if err != nil {
		writeAPIError(w, 502, "identity_provider_failed")
		return
	}
	account, err := s.repo.UpsertIdentity(ctx, identity)
	if err != nil {
		writeError(w, err)
		return
	}
	s.offerConsent(w, r, account, flow.UserCode)
}

func (s *Server) offerConsent(w http.ResponseWriter, r *http.Request, a Account, userCode string) {
	nonce, err := newSecret(32)
	if err != nil {
		writeError(w, err)
		return
	}
	flow := AuthFlow{Hash: secretHash(nonce), Kind: "consent", UserCode: userCode, AccountID: a.ID, ExpiresAt: s.now().Add(5 * time.Minute)}
	if err = s.repo.CreateFlow(r.Context(), flow); err != nil {
		writeError(w, err)
		return
	}
	s.setAuthCookie(w, "gonavi_market_consent", nonce, 300)
	s.renderAuthPage(w, r, consentHTML, authPageData{Login: a.Login, Code: userCode, Nonce: nonce})
}

func (s *Server) decideDevice(w http.ResponseWriter, r *http.Request) {
	if !s.authAvailable(w) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if err := r.ParseForm(); err != nil {
		writeError(w, ErrInvalid)
		return
	}
	nonce := r.PostForm.Get("nonce")
	if !cookieMatches(r, "gonavi_market_consent", nonce) {
		writeAPIError(w, 403, "invalid_csrf")
		return
	}
	decision := r.PostForm.Get("decision")
	if decision != "approve" && decision != "deny" {
		writeError(w, ErrInvalid)
		return
	}
	s.setAuthCookie(w, "gonavi_market_consent", "", -1)
	flow, err := s.repo.ConsumeFlow(r.Context(), secretHash(nonce), "consent", s.now())
	if err != nil {
		writeError(w, ErrUnauthorized)
		return
	}
	if err = s.repo.DecideDevice(r.Context(), secretHash(flow.UserCode), flow.AccountID, decision == "approve", s.now()); err != nil {
		writeError(w, err)
		return
	}
	message := "denied"
	if decision == "approve" {
		message = "authorized"
	}
	s.renderAuthPage(w, r, decisionHTML, authPageData{Decision: message})
}
