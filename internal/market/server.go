package market

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"

	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/shared/i18n"
)

// ServerOptions wires explicit infrastructure; nil identity disables login, not authentication.
type ServerOptions struct {
	Repository Repository
	Artifacts  ArtifactStore
	Identity   IdentityProvider
	PublicURL  string
	Clock      func() time.Time
}

// Server owns HTTP policy; repository methods own atomic domain invariants.
type Server struct {
	repo          Repository
	artifacts     ArtifactStore
	identity      IdentityProvider
	localizer     *i18n.Localizer
	publicURL     string
	secure        bool
	now           func() time.Time
	limitMu       sync.Mutex
	limits        map[string]requestLimit
	slots         chan struct{}
	uploadSlots   chan struct{}
	artifactSlots chan struct{}
}

type requestLimit struct {
	count int
	reset time.Time
}

// APIError is the stable JSON envelope for every unsuccessful API request.
type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// NewServer refuses incomplete persistence and unsafe public callback origins.
func NewServer(o ServerOptions) (*Server, error) {
	if o.Repository == nil || o.Artifacts == nil {
		return nil, ErrInvalid
	}
	base, secure, err := validatePublicURL(o.PublicURL)
	if err != nil {
		return nil, err
	}
	if o.Clock == nil {
		o.Clock = time.Now
	}
	localizer, err := i18n.NewLocalizer(i18n.LanguageEnUS)
	if err != nil {
		return nil, err
	}
	return &Server{repo: o.Repository, artifacts: o.Artifacts, identity: o.Identity, localizer: localizer, publicURL: base, secure: secure, now: o.Clock,
		limits: make(map[string]requestLimit), slots: make(chan struct{}, 64), uploadSlots: make(chan struct{}, 2), artifactSlots: make(chan struct{}, 2)}, nil // Two artifact operations bound archive and object-store snapshots.
}

// Handler returns an isolated net/http API with no desktop or plugin execution capability.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/plugins", s.catalog)
	mux.HandleFunc("GET /api/v1/plugins/{id}", pluginRoute(s.detail))
	mux.HandleFunc("GET /api/v1/plugins/{id}/versions", pluginRoute(s.versions))
	mux.HandleFunc("GET /api/v1/plugins/{id}/versions/{version}/artifact", pluginRoute(s.artifactDescriptor))
	mux.HandleFunc("GET /api/v1/artifacts/{digest}", s.download)
	mux.HandleFunc("GET /api/v1/plugins/{id}/ratings", pluginRoute(s.ratings))
	mux.HandleFunc("PUT /api/v1/plugins/{id}/rating", pluginRoute(s.rate))
	mux.HandleFunc("DELETE /api/v1/plugins/{id}/rating", pluginRoute(s.deleteRating))
	mux.HandleFunc("POST /api/v1/reports", s.report)
	mux.HandleFunc("POST /api/v1/submissions", s.submit)
	mux.HandleFunc("GET /api/v1/submissions", s.submissions)
	mux.HandleFunc("GET /api/v1/admin/submissions", s.adminSubmissions)
	mux.HandleFunc("GET /api/v1/admin/submissions/{id}", s.adminSubmission)
	mux.HandleFunc("GET /api/v1/admin/submissions/{id}/artifact", s.adminArtifact)
	mux.HandleFunc("POST /api/v1/admin/submissions/{id}/{action}", s.review)
	mux.HandleFunc("GET /api/v1/admin/audit", s.audit)
	mux.HandleFunc("POST /api/v1/admin/plugins/{id}/ratings/{user}/hide", s.hideRating)
	mux.HandleFunc("POST /api/v1/auth/device", s.startDevice)
	mux.HandleFunc("POST /api/v1/auth/device/token", s.pollDevice)
	mux.HandleFunc("GET /api/v1/auth/session", s.session)
	mux.HandleFunc("POST /api/v1/auth/logout", s.logout)
	mux.HandleFunc("GET /api/v1/auth/device", s.devicePage)
	mux.HandleFunc("GET /api/v1/auth/github", s.startOAuth)
	mux.HandleFunc("GET /api/v1/auth/github/callback", s.oauthCallback)
	mux.HandleFunc("POST /api/v1/auth/device/decision", s.decideDevice)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { writeError(w, ErrNotFound) })
	return s.protect(mux)
}

func pluginRoute(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !validPluginID(r.PathValue("id")) {
			writeError(w, ErrNotFound)
			return
		}
		next(w, r)
	}
}

func (s *Server) protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; form-action 'self' https://github.com; frame-ancestors 'none'; base-uri 'none'")
		if len(r.URL.RequestURI()) > 8192 {
			writeAPIError(w, 414, "request_too_large")
			return
		}
		select {
		case s.slots <- struct{}{}:
			defer func() { <-s.slots }()
		default:
			writeAPIError(w, 503, "server_busy")
			return
		}
		if (r.Method != "GET" || strings.HasPrefix(r.URL.Path, "/api/v1/auth/")) && !s.allowWrite(r) {
			w.Header().Set("Retry-After", "60")
			writeAPIError(w, 429, "rate_limited")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) allowWrite(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	now := s.now()
	s.limitMu.Lock()
	defer s.limitMu.Unlock()
	limit, exists := s.limits[host]
	if !exists && len(s.limits) >= 8192 {
		for key, entry := range s.limits {
			if !entry.reset.After(now) {
				delete(s.limits, key)
			}
		}
		if len(s.limits) >= 8192 {
			return false
		}
	}
	if !limit.reset.After(now) {
		limit = requestLimit{reset: now.Add(time.Minute)}
	}
	limit.count++
	s.limits[host] = limit
	return limit.count <= 120
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return ErrInvalid
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return ErrInvalid
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		logger.Warnf("market response write failed")
	}
}

func writeAPIError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, APIError{Code: code, Message: code})
}

func writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrInvalid):
		writeAPIError(w, 400, "invalid_request")
	case errors.Is(err, ErrUnauthorized):
		writeAPIError(w, 401, "unauthorized")
	case errors.Is(err, ErrForbidden):
		writeAPIError(w, 403, "forbidden")
	case errors.Is(err, ErrNotFound):
		writeAPIError(w, 404, "not_found")
	case errors.Is(err, ErrConflict):
		writeAPIError(w, 409, "conflict")
	case errors.Is(err, context.DeadlineExceeded):
		writeAPIError(w, 504, "deadline_exceeded")
	case errors.Is(err, context.Canceled):
		writeAPIError(w, 408, "request_canceled")
	default:
		logger.Warnf("market request failed: category=internal")
		writeAPIError(w, 500, "internal_error")
	}
}

func bearer(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return ""
	}
	value := strings.TrimPrefix(header, "Bearer ")
	if len(value) != 43 || strings.IndexFunc(value, unicode.IsSpace) >= 0 {
		return ""
	}
	return value
}

func (s *Server) account(w http.ResponseWriter, r *http.Request) (Account, bool) {
	token := bearer(r)
	if token == "" {
		writeError(w, ErrUnauthorized)
		return Account{}, false
	}
	a, err := s.repo.Session(r.Context(), secretHash(token), s.now())
	if err != nil {
		writeError(w, err)
		return Account{}, false
	}
	return a, true
}

func (s *Server) admin(w http.ResponseWriter, r *http.Request) (Account, bool) {
	a, ok := s.account(w, r)
	if !ok {
		return a, false
	}
	if a.Role != "admin" {
		writeError(w, ErrForbidden)
		return a, false
	}
	return a, true
}
