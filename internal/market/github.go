package market

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode"
)

// Identity identifies an account by its immutable provider ID and current login.
type Identity struct {
	ID    string
	Login string
}

// IdentityProvider exchanges an authorization code after the caller verifies state.
// The caller owns state, PKCE generation, browser callbacks, and session lifecycle.
type IdentityProvider interface {
	AuthorizeURL(state, challenge string) string
	Exchange(ctx context.Context, code, verifier string) (Identity, error)
}

// GitHubConfig configures server-side GitHub OAuth with no additional scopes.
// CallbackURL must use HTTPS, or HTTP on a loopback host for local development.
// HTTPClient is copied; its transport is trusted, cookies and redirects are disabled,
// and its timeout is capped at ten seconds for the entire exchange.
type GitHubConfig struct {
	ClientID     string
	ClientSecret string
	CallbackURL  string
	HTTPClient   *http.Client
}

// GitHubProvider authenticates against GitHub.com without retaining access tokens.
// Construct it with NewGitHubProvider; its zero value cannot authenticate.
type GitHubProvider struct {
	clientID     string
	clientSecret string
	callbackURL  string
	httpClient   *http.Client
	authorizeURL string
	tokenURL     string
	userURL      string
}

var _ IdentityProvider = (*GitHubProvider)(nil)

// NewGitHubProvider validates OAuth configuration without making network requests.
func NewGitHubProvider(config GitHubConfig) (*GitHubProvider, error) {
	if strings.TrimSpace(config.ClientID) == "" {
		return nil, errors.New("github client ID is required")
	}
	if strings.TrimSpace(config.ClientSecret) == "" {
		return nil, errors.New("github client secret is required")
	}
	if !githubValidCallbackURL(config.CallbackURL) {
		return nil, errors.New("github callback URL must use HTTPS or loopback HTTP without credentials or a fragment")
	}
	return &GitHubProvider{
		clientID:     config.ClientID,
		clientSecret: config.ClientSecret,
		callbackURL:  config.CallbackURL,
		httpClient:   githubHTTPClient(config.HTTPClient),
		authorizeURL: "https://github.com/login/oauth/authorize",
		tokenURL:     "https://github.com/login/oauth/access_token",
		userURL:      "https://api.github.com/user",
	}, nil
}

// AuthorizeURL includes the caller's state and already hashed S256 challenge.
// Empty state or challenge returns an empty URL rather than weakening the flow.
func (p *GitHubProvider) AuthorizeURL(state, challenge string) string {
	if p == nil || p.httpClient == nil || strings.TrimSpace(state) == "" || strings.TrimSpace(challenge) == "" {
		return ""
	}
	query := url.Values{
		"client_id":             {p.clientID},
		"redirect_uri":          {p.callbackURL},
		"state":                 {state},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
		"scope":                 {""},
	}
	return p.authorizeURL + "?" + query.Encode()
}

// Exchange exchanges a code with its original verifier, then fetches /user.
// The caller must validate callback state before calling; tokens are never returned.
func (p *GitHubProvider) Exchange(ctx context.Context, code, verifier string) (Identity, error) {
	if p == nil || p.httpClient == nil {
		return Identity{}, errors.New("github provider is not initialized")
	}
	if ctx == nil {
		return Identity{}, errors.New("github exchange context is required")
	}
	if strings.TrimSpace(code) == "" || strings.TrimSpace(verifier) == "" {
		return Identity{}, errors.New("github authorization code and PKCE verifier are required")
	}
	ctx, cancel := context.WithTimeout(ctx, p.httpClient.Timeout)
	defer cancel()

	token, err := p.exchangeToken(ctx, code, verifier)
	if err != nil {
		return Identity{}, err
	}
	return p.fetchIdentity(ctx, token)
}

func (p *GitHubProvider) exchangeToken(ctx context.Context, code, verifier string) (string, error) {
	form := url.Values{
		"client_id":     {p.clientID},
		"client_secret": {p.clientSecret},
		"redirect_uri":  {p.callbackURL},
		"code":          {code},
		"code_verifier": {verifier},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", errors.New("create github token request failed")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	var token struct {
		AccessToken string          `json:"access_token"`
		TokenType   string          `json:"token_type"`
		Error       json.RawMessage `json:"error"`
	}
	if err := p.requestJSON(ctx, "token", req, &token); err != nil {
		return "", err
	}
	if token.Error != nil || !strings.EqualFold(token.TokenType, "bearer") || !githubValidToken(token.AccessToken) {
		return "", errors.New("github token response is invalid or denied")
	}
	return token.AccessToken, nil
}

func (p *GitHubProvider) fetchIdentity(ctx context.Context, token string) (Identity, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.userURL, nil)
	if err != nil {
		return Identity{}, errors.New("create github identity request failed")
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+token)
	var user struct {
		ID    uint64 `json:"id"`
		Login string `json:"login"`
	}
	if err := p.requestJSON(ctx, "identity", req, &user); err != nil {
		return Identity{}, err
	}
	if user.ID == 0 || user.Login == "" || strings.ContainsFunc(user.Login, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r)
	}) {
		return Identity{}, errors.New("github identity response is invalid")
	}
	return Identity{ID: strconv.FormatUint(user.ID, 10), Login: user.Login}, nil
}

func githubValidCallbackURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || strings.Contains(raw, "#") || u.Opaque != "" {
		return false
	}
	if u.Scheme == "https" {
		return true
	}
	if u.Scheme != "http" {
		return false
	}
	host := u.Hostname()
	return strings.EqualFold(host, "localhost") || net.ParseIP(host).IsLoopback()
}

func githubValidToken(token string) bool {
	if token == "" || token[0] == '=' {
		return false
	}
	padding := false
	for _, r := range token {
		if r == '=' {
			padding = true
			continue
		}
		if padding || !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("-._~+/", r)) {
			return false
		}
	}
	return true
}
