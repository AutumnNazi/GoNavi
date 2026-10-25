package market

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// ReleaseSource describes one GitHub release asset candidate for auto-sync.
type ReleaseSource struct {
	Owner, Repo string
	Tag         string
	AssetURL    string
	AssetName   string
}

var githubRepoPattern = regexp.MustCompile(`^https://github\.com/([A-Za-z0-9-]+)/([A-Za-z0-9_.-]+)/?$`)

// parseRepositoryURL extracts owner/repo from a canonical GitHub repository URL.
func parseRepositoryURL(raw string) (string, string, error) {
	match := githubRepoPattern.FindStringSubmatch(strings.TrimSpace(raw))
	if match == nil {
		return "", "", ErrInvalid
	}
	return match[1], match[2], nil
}

// ReleaseFetcher reads release metadata and asset bytes so tests can stub GitHub.
type ReleaseFetcher interface {
	LatestRelease(ctx context.Context, owner, repo string) (ReleaseSource, error)
	FetchAsset(ctx context.Context, url string) ([]byte, error)
}

// GitHubReleaseFetcher talks to the public GitHub API; an optional token lifts
// the anonymous 60 requests/hour ceiling for larger catalogs.
type GitHubReleaseFetcher struct {
	client *http.Client
	token  string
}

// NewGitHubReleaseFetcher creates the production fetcher with bounded timeouts.
func NewGitHubReleaseFetcher(token string) *GitHubReleaseFetcher {
	return &GitHubReleaseFetcher{client: &http.Client{Timeout: 2 * time.Minute}, token: token}
}

type githubRelease struct {
	TagName string `json:"tag_name"`
	Assets  []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

// LatestRelease returns the single archive asset of the repository's latest
// non-draft, non-prerelease release. Ambiguous or asset-less releases are errors,
// never a guess: a wrong archive would publish under the wrong plugin identity.
func (f *GitHubReleaseFetcher) LatestRelease(ctx context.Context, owner, repo string) (ReleaseSource, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", owner, repo), nil)
	if err != nil {
		return ReleaseSource{}, ErrInvalid
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	if f.token != "" {
		request.Header.Set("Authorization", "Bearer "+f.token)
	}
	response, err := f.client.Do(request)
	if err != nil {
		return ReleaseSource{}, fmt.Errorf("release request failed")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return ReleaseSource{}, ErrNotFound
	}
	if response.StatusCode != http.StatusOK {
		return ReleaseSource{}, fmt.Errorf("release request status %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return ReleaseSource{}, fmt.Errorf("release metadata read failed")
	}
	var release githubRelease
	if err = json.Unmarshal(data, &release); err != nil || release.TagName == "" {
		return ReleaseSource{}, ErrInvalid
	}
	var candidates []int
	for index, asset := range release.Assets {
		lower := strings.ToLower(asset.Name)
		if strings.HasSuffix(lower, ".zip") || strings.HasSuffix(lower, ".tgz") || strings.HasSuffix(lower, ".tar.gz") {
			candidates = append(candidates, index)
		}
	}
	if len(candidates) != 1 {
		return ReleaseSource{}, ErrConflict
	}
	asset := release.Assets[candidates[0]]
	if asset.BrowserDownloadURL == "" {
		return ReleaseSource{}, ErrInvalid
	}
	return ReleaseSource{Owner: owner, Repo: repo, Tag: release.TagName, AssetURL: asset.BrowserDownloadURL, AssetName: asset.Name}, nil
}

// FetchAsset downloads one release archive bounded by the package size limit.
func (f *GitHubReleaseFetcher) FetchAsset(ctx context.Context, url string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, ErrInvalid
	}
	if f.token != "" {
		request.Header.Set("Authorization", "Bearer "+f.token)
	}
	response, err := f.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("asset download failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("asset download status %d", response.StatusCode)
	}
	return io.ReadAll(io.LimitReader(response.Body, MaxArtifactBytes+1))
}
