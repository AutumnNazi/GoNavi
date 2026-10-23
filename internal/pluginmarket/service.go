package pluginmarket

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"GoNavi-Wails/internal/secretstore"
)

const (
	maxJSONBytes          = 2 << 20
	maxStateBytes         = 1 << 20
	maxArchiveBytes int64 = 128 << 20
	apiTimeout            = 20 * time.Second
	downloadTimeout       = 2 * time.Minute
)

// Service owns source-scoped credentials, cached public data and install provenance.
// Network calls never hold mu and are fenced against source changes and logout.
type Service struct {
	mu                sync.Mutex
	authMu            sync.Mutex
	currentSource     atomic.Value
	root              string
	secrets           secretstore.SecretStore
	client            *http.Client
	downloadClient    *http.Client
	hostVersion       string
	officialURL       string
	state             diskState
	generation        uint64
	authGeneration    uint64
	pending           map[string]pendingLogin
	receipts          map[string]downloadReceipt
	downloadsInFlight int
	now               func() time.Time
}

type sourceSnapshot struct {
	base       string
	id         string
	trusted    bool
	generation uint64
}

// NewService loads local state only; unavailable remote services cannot block local plugin management.
func NewService(o Options) (*Service, error) {
	if o.Root == "" || len(o.HostVersion) > 128 {
		return nil, ErrInvalidRequest
	}
	root, err := filepath.Abs(o.Root)
	if err != nil {
		return nil, fmt.Errorf("resolve marketplace state root: %w", err)
	}
	official, err := normalizeBase(o.TrustedOfficialURL)
	if err != nil {
		return nil, fmt.Errorf("validate trusted official source: %w", err)
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		return nil, fmt.Errorf("create marketplace state root: %w", err)
	}
	state, err := readState(filepath.Join(root, "settings.json"))
	if err != nil {
		return nil, err
	}
	if state == nil {
		state = &diskState{Version: 1, BaseURL: official, Installs: make(map[string]installedSource)}
	}
	if o.Secrets == nil {
		o.Secrets = secretstore.NewUnavailableStore("marketplace secret store not configured")
	}
	service := &Service{root: root, secrets: o.Secrets, client: boundedClient(o.Client, apiTimeout),
		downloadClient: boundedClient(o.Client, downloadTimeout), hostVersion: o.HostVersion,
		officialURL: official, state: *state, pending: make(map[string]pendingLogin),
		receipts: make(map[string]downloadReceipt), now: time.Now}
	service.currentSource.Store(sourceID(state.BaseURL))
	return service, nil
}

func boundedClient(original *http.Client, timeout time.Duration) *http.Client {
	client := &http.Client{}
	if original != nil {
		*client = *original
	}
	if client.Timeout <= 0 || client.Timeout > timeout {
		client.Timeout = timeout
	}
	client.Jar = nil
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return ErrRedirect }
	if client.Transport == nil {
		client.Transport = &http.Transport{Proxy: http.ProxyFromEnvironment,
			DialContext:         (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 10 * time.Second,
			IdleConnTimeout: 60 * time.Second, MaxIdleConns: 20, MaxIdleConnsPerHost: 4,
			MaxResponseHeaderBytes: 32 << 10, ForceAttemptHTTP2: true}
	}
	return client
}

// CurrentSourceID returns the last successfully configured source, or ErrNotConfigured when access is disabled.
// This atomic snapshot never calls the keychain, HTTP or filesystem, nor waits on state persistence locks.
// It is not download provenance; use DownloadSourceID to bind approval to prepared archive bytes.
func (s *Service) CurrentSourceID() (string, error) {
	id, ok := s.currentSource.Load().(string)
	if !ok || id == "" {
		return "", ErrNotConfigured
	}
	return id, nil
}

// Settings returns the selected source and whether its local session is unexpired.
// This is not a network assertion that the server has not revoked the session. An unavailable keychain leaves browsing anonymous.
func (s *Service) Settings() (Settings, error) {
	s.mu.Lock()
	result := s.settingsLocked()
	source := s.snapshotLocked()
	authGeneration := s.authGeneration
	s.mu.Unlock()
	if result.BaseURL == "" {
		return result, nil
	}
	token, err := s.loadToken(result.SourceID)
	s.mu.Lock()
	defer s.mu.Unlock()
	if sourceErr := s.checkSourceLocked(source); sourceErr != nil {
		return s.settingsLocked(), sourceErr
	}
	if authGeneration != s.authGeneration {
		return result, nil
	}
	if errors.Is(err, ErrUnauthenticated) || secretstore.IsUnavailable(err) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	result.Authenticated = token.AccessToken != ""
	return result, nil
}

func (s *Service) settingsLocked() Settings {
	base := s.state.BaseURL
	return Settings{BaseURL: base, SourceID: sourceID(base), TrustedOfficial: base != "" && base == s.officialURL}
}

// Configure atomically selects an endpoint without probing it or moving credentials between sources.
// An empty URL explicitly disables marketplace access; cached pages and provenance remain local.
func (s *Service) Configure(ctx context.Context, baseURL string) (Settings, error) {
	base, err := normalizeBase(baseURL)
	if err != nil {
		return Settings{}, err
	}
	if err = ctx.Err(); err != nil {
		return Settings{}, err
	}
	s.mu.Lock()
	if err = ctx.Err(); err == nil {
		next := s.state
		next.BaseURL = base
		if err = atomicJSON(filepath.Join(s.root, "settings.json"), next, maxStateBytes); err == nil {
			if base != s.state.BaseURL {
				s.generation++
				s.authGeneration++
				clear(s.pending)
			}
			s.state = next
			s.currentSource.Store(sourceID(next.BaseURL))
		}
	}
	result := s.settingsLocked()
	s.mu.Unlock()
	if err != nil {
		return result, fmt.Errorf("configure marketplace: %w", err)
	}
	return s.Settings()
}

func (s *Service) snapshot() (sourceSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	source := s.snapshotLocked()
	if source.base == "" {
		return source, ErrNotConfigured
	}
	return source, nil
}

func (s *Service) snapshotLocked() sourceSnapshot {
	return sourceSnapshot{base: s.state.BaseURL, id: sourceID(s.state.BaseURL),
		trusted: s.state.BaseURL != "" && s.state.BaseURL == s.officialURL, generation: s.generation}
}

func (s *Service) checkSource(source sourceSnapshot) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.checkSourceLocked(source)
}

func (s *Service) checkSourceLocked(source sourceSnapshot) error {
	if source.generation != s.generation || source.base != s.state.BaseURL {
		return ErrSourceChanged
	}
	return nil
}
