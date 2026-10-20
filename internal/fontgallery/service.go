package fontgallery

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/appdata"
)

// Options selects the active application data root and injectable HTTP client.
type Options struct {
	Root    string
	BaseURL string
	Client  *http.Client
}

// Service owns no UI selection and never downloads during local reads.
type Service struct {
	root        string
	base        *url.URL
	client      *http.Client
	mu          sync.RWMutex
	slots       chan struct{}
	replaceFile func(source, target string) error
}

// NewService initializes private storage without performing network requests.
func NewService(options Options) (*Service, error) {
	if strings.TrimSpace(options.Root) == "" {
		return nil, failure("storage_failed", "missing application root")
	}
	baseURL := options.BaseURL
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	base, err := url.Parse(baseURL)
	if err != nil || base.Scheme != "https" || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" || base.RawPath != "" || strings.Contains(base.Path, "\\") || !strings.HasSuffix(base.Path, "/") || strings.Contains(base.Path, "..") {
		return nil, failure("invalid_catalog", "invalid font gallery base url")
	}
	root, err := filepath.Abs(options.Root)
	if err != nil {
		return nil, wrap("storage_failed", err)
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, wrap("storage_failed", err)
	}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() {
		return nil, failure("storage_failed", "application root is not a directory")
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return nil, wrap("storage_failed", err)
	}
	for _, part := range []string{"font-gallery", "v1", "assets"} {
		root = filepath.Join(root, part)
		if err := os.Mkdir(root, 0700); err != nil && !os.IsExist(err) {
			return nil, wrap("storage_failed", err)
		}
		info, err = os.Lstat(root)
		if err != nil || !info.IsDir() {
			return nil, failure("storage_failed", "unsafe font gallery directory")
		}
	}
	client := http.Client{Timeout: 45 * time.Second}
	if options.Client != nil {
		client = *options.Client
	}
	if client.Timeout <= 0 || client.Timeout > 45*time.Second {
		client.Timeout = 45 * time.Second
	}
	client.Jar = nil
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Service{root: filepath.Dir(root), base: base, client: &client, slots: make(chan struct{}, 2), replaceFile: appdata.AtomicReplaceFile}, nil
}

// Status reads local metadata and verified installations without network I/O.
func (s *Service) Status() (State, error) {
	return s.statusContext(context.Background())
}

func (s *Service) statusContext(ctx context.Context) (State, error) {
	state := State{Installed: []Installed{}}
	err := s.snapshotContext(ctx, func() error {
		var err error
		state.Catalog, err = s.cachedCatalog()
		if err != nil {
			state.Stale = true
			state.WarningCode = ErrorCode(err)
		}
		entries, err := s.installedEntries()
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if _, err := s.verifiedAsset(entry.Font); err != nil {
				state.WarningCode = ErrorCode(err)
				continue
			}
			state.Installed = append(state.Installed, installation(entry))
		}
		return nil
	})
	return state, err
}
