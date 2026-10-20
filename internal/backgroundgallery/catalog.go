package backgroundgallery

import (
	"context"
	"io"
	"mime"
	"net/http"
)

func (s *Service) request(ctx context.Context, path string) (*http.Response, error) {
	target := *s.base
	target.Path += path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, wrap("download_failed", err)
	}
	req.Header.Set("Accept-Encoding", "identity")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, wrap("download_failed", err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, failure("download_failed", "unexpected remote status")
	}
	if resp.Header.Get("Content-Encoding") != "" && resp.Header.Get("Content-Encoding") != "identity" {
		resp.Body.Close()
		return nil, failure("download_failed", "encoded response is forbidden")
	}
	return resp, nil
}
func (s *Service) acquire(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case s.slots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (s *Service) fetchCatalog(ctx context.Context) ([]byte, error) {
	if err := s.acquire(ctx); err != nil {
		return nil, err
	}
	defer func() { <-s.slots }()
	resp, err := s.request(ctx, "catalog.json")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	contentType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil || contentType != "application/json" || resp.ContentLength > maxCatalogBytes {
		return nil, failure("invalid_catalog", "invalid manifest response bounds or mime")
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, maxCatalogBytes+1))
	if err != nil {
		return nil, wrap("download_failed", err)
	}
	if _, err := parseCatalog(payload); err != nil {
		return nil, err
	}
	return payload, nil
}

// Refresh is the sole catalog network operation. A valid cached catalog is
// returned stale with WarningCode on failure; without one the error is returned.
// Request cancellation returns an error instead of starting a stale fallback.
func (s *Service) Refresh(ctx context.Context) (State, error) {
	payload, err := s.fetchCatalog(ctx)
	if err == nil {
		err = s.transactionContext(ctx, func() error {
			if err := ctx.Err(); err != nil {
				return err
			}
			return wrap("storage_failed", s.atomicWrite("catalog.json", payload))
		})
	}
	// Cancellation must not turn into a successful stale response or start an
	// uncancellable local read while another transaction owns the mutex.
	if ctxErr := ctx.Err(); ctxErr != nil {
		return State{Installed: []Installed{}}, ctxErr
	}
	state, statusErr := s.statusContext(ctx)
	if statusErr != nil {
		return state, statusErr
	}
	if err != nil {
		if state.Catalog == nil {
			return state, err
		}
		state.Stale = true
		state.WarningCode = ErrorCode(err)
	}
	return state, nil
}
