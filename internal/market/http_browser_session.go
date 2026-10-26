package market

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Browser sessions share the market_sessions table with desktop bearer tokens;
// only the transport differs. The CSRF header is derived from the cookie secret
// so the browser never receives a separately stored anti-forgery secret.
const (
	csrfHeader          = "X-GoNavi-CSRF"
	csrfTokenPrefix     = "gonavi-market-csrf:"
	csrfTokenBytes      = 43 // base64url of one SHA-256 digest
	browserSessionAge   = 86400
	browserCookieSecure = "__Host-gonavi_market_session"
	browserCookieLocal  = "gonavi_market_session"
	browserStateCookie  = "gonavi_market_oauth"
	browserReturnCookie = "gonavi_market_web_return"
	browserCookiePath   = "/api/v1/auth/"
	defaultReturnTo     = "/account"
)

// authentication records how a request proved its identity so mutating cookie
// requests can demand the derived CSRF token while bearer clients stay exempt.
type authentication struct {
	account Account
	token   string
	browser bool
}

func (s *Server) browserSessionCookie() string {
	if s.secure {
		return browserCookieSecure
	}
	return browserCookieLocal
}

func (s *Server) sessionToken(r *http.Request) string {
	cookie, err := r.Cookie(s.browserSessionCookie())
	if err != nil || len(cookie.Value) != 43 {
		return ""
	}
	return cookie.Value
}

// authenticate prefers the explicit bearer header so a stale browser cookie can
// never override a caller that presents desktop credentials.
func (s *Server) authenticate(r *http.Request) (authentication, error) {
	if token := bearer(r); token != "" {
		a, err := s.repo.Session(r.Context(), secretHash(token), s.now())
		return authentication{account: a, token: token}, err
	}
	token := s.sessionToken(r)
	if token == "" {
		return authentication{}, ErrUnauthorized
	}
	a, err := s.repo.Session(r.Context(), secretHash(token), s.now())
	if err != nil {
		return authentication{}, err
	}
	return authentication{account: a, token: token, browser: true}, nil
}

func mutatingRequest(method string) bool {
	return method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions
}

// authorize is account() with CSRF enforcement for cookie-authenticated writes.
func (s *Server) authorize(w http.ResponseWriter, r *http.Request) (authentication, bool) {
	auth, err := s.authenticate(r)
	if err != nil {
		writeError(w, err)
		return authentication{}, false
	}
	if auth.browser && mutatingRequest(r.Method) && !validCSRF(r, auth.token) {
		writeAPIError(w, http.StatusForbidden, "invalid_csrf")
		return authentication{}, false
	}
	return auth, true
}

func csrfToken(sessionToken string) string {
	digest := sha256.Sum256([]byte(csrfTokenPrefix + sessionToken))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func validCSRF(r *http.Request, sessionToken string) bool {
	provided := r.Header.Get(csrfHeader)
	if len(provided) != csrfTokenBytes {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(csrfToken(sessionToken))) == 1
}

func (s *Server) setSessionCookie(w http.ResponseWriter, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: s.browserSessionCookie(), Value: token, Path: "/", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}

// setBrowserFlowCookie scopes the short-lived OAuth cookies to the login flow.
func (s *Server) setBrowserFlowCookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: browserCookiePath, HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}

func browserCookieMatches(r *http.Request, name, value string) bool {
	cookie, err := r.Cookie(name)
	return err == nil && len(value) == 43 && subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(value)) == 1
}

// browserReturnTo accepts only a same-origin absolute path; anything else falls
// back to the account page so OAuth cannot be turned into an open redirect.
func browserReturnTo(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" || len(value) > 2048 || !utf8.ValidString(value) || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || strings.ContainsRune(value, '\\') {
		return defaultReturnTo
	}
	if strings.IndexFunc(value, func(r rune) bool { return r < 0x20 || r == 0x7f || unicode.IsSpace(r) }) >= 0 {
		return defaultReturnTo
	}
	return value
}

func (s *Server) browserReturnTarget(r *http.Request) string {
	cookie, err := r.Cookie(browserReturnCookie)
	if err != nil {
		return defaultReturnTo
	}
	decoded, err := url.QueryUnescape(cookie.Value)
	if err != nil {
		return defaultReturnTo
	}
	return browserReturnTo(decoded)
}

func redirectLogin(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, "/login?error="+url.QueryEscape(code), http.StatusSeeOther)
}

// webSession reports the browser login state without requiring authentication.
func (s *Server) webSession(w http.ResponseWriter, r *http.Request) {
	auth, err := s.authenticate(r)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusOK, map[string]bool{"authenticated": false})
			return
		}
		writeError(w, err)
		return
	}
	account := auth.account
	writeJSON(w, http.StatusOK, struct {
		Authenticated bool    `json:"authenticated"`
		Account       Account `json:"account"`
		CSRFToken     string  `json:"csrfToken"`
	}{Authenticated: true, Account: account, CSRFToken: csrfToken(auth.token)})
}

// webLogout revokes the presented session; cookie callers must pass the CSRF
// header first, so a cross-site form post cannot sign an author out.
func (s *Server) webLogout(w http.ResponseWriter, r *http.Request) {
	auth, ok := s.authorize(w, r)
	if !ok {
		return
	}
	if err := s.repo.RevokeSession(r.Context(), secretHash(auth.token)); err != nil {
		writeError(w, err)
		return
	}
	s.setSessionCookie(w, "", -1)
	writeJSON(w, http.StatusOK, map[string]bool{"revoked": true})
}

// webSessionExpiry is shared by the browser callback and its tests.
func (s *Server) webSessionExpiry() time.Time {
	return s.now().Add(browserSessionAge * time.Second)
}
