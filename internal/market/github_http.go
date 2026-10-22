package market

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	githubHTTPTimeout  = 10 * time.Second
	githubMaxBodyBytes = 1 << 20
)

func githubHTTPClient(source *http.Client) *http.Client {
	client := http.Client{Timeout: githubHTTPTimeout}
	if source != nil {
		client = *source
	}
	if client.Timeout <= 0 || client.Timeout > githubHTTPTimeout {
		client.Timeout = githubHTTPTimeout
	}
	// A shared application's cookie jar must not affect OAuth or /user identity.
	client.Jar = nil
	// Reject even same-origin redirects: 307/308 can forward the secret POST body.
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &client
}

func (p *GitHubProvider) requestJSON(ctx context.Context, stage string, req *http.Request, target any) error {
	req.Header.Set("User-Agent", "GoNavi-Market")
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return githubRequestError(ctx, stage, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("github %s endpoint returned HTTP %d", stage, resp.StatusCode)
	}
	if resp.ContentLength > githubMaxBodyBytes {
		return fmt.Errorf("github %s response exceeds 1 MiB", stage)
	}
	// Read one sentinel byte to distinguish a full-size response from truncation.
	body, err := io.ReadAll(io.LimitReader(resp.Body, githubMaxBodyBytes+1))
	if err != nil {
		return githubRequestError(ctx, stage, err)
	}
	if len(body) > githubMaxBodyBytes {
		return fmt.Errorf("github %s response exceeds 1 MiB", stage)
	}
	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("github %s response is invalid JSON", stage)
	}
	return nil
}

func githubRequestError(ctx context.Context, stage string, err error) error {
	// Network/read errors may echo credentials; only wrap canonical context errors.
	if ctx.Err() != nil {
		return fmt.Errorf("github %s request failed: %w", stage, ctx.Err())
	}
	if errors.Is(err, context.Canceled) {
		return fmt.Errorf("github %s request failed: %w", stage, context.Canceled)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("github %s request failed: %w", stage, context.DeadlineExceeded)
	}
	return fmt.Errorf("github %s request failed", stage)
}
