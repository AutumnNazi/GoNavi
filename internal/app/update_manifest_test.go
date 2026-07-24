package app

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	stdRuntime "runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func configureUpdateManifestHTTPTest(t *testing.T) {
	t.Helper()
	for _, name := range []string{
		"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
		"http_proxy", "https_proxy", "all_proxy",
	} {
		t.Setenv(name, "")
	}
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")
	t.Setenv("no_proxy", "127.0.0.1,localhost")
	t.Setenv("GONAVI_DATA_ROOT", t.TempDir())
}

func buildValidUpdateManifestForTest(
	t *testing.T,
	channel updateChannel,
	version string,
	publishedAt string,
	hashCharacter string,
) updateReleaseManifest {
	t.Helper()
	expectedAsset, err := expectedAssetNameForInstallMode(
		stdRuntime.GOOS,
		stdRuntime.GOARCH,
		version,
		updateResolveInstallMode(),
	)
	if err != nil {
		t.Fatalf("resolve expected update asset: %v", err)
	}
	tagName := "v" + normalizeVersion(version)
	name := tagName
	if channel == updateChannelDev {
		tagName = updateDevReleaseTag
		name = "Dev Build (" + version + ")"
	}
	return updateReleaseManifest{
		SchemaVersion: updateManifestSchemaVersion,
		Channel:       string(channel),
		TagName:       tagName,
		Version:       version,
		Name:          name,
		PublishedAt:   publishedAt,
		Assets: []updateManifestAsset{{
			Name:   expectedAsset,
			URL:    "https://download.example.test/" + expectedAsset,
			APIURL: "https://github.example.test/" + expectedAsset,
			Size:   123,
			SHA256: strings.Repeat(hashCharacter, 64),
		}},
	}
}

func serveUpdateManifestForTest(t *testing.T, manifest updateReleaseManifest, hits *atomic.Int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if hits != nil {
			hits.Add(1)
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(manifest); err != nil {
			t.Errorf("encode manifest: %v", err)
		}
	}))
}

func TestDownloadUpdateAssetWithFallbackRetriesChecksumMismatch(t *testing.T) {
	goodPayload := []byte("verified update package")
	expectedHash := fmt.Sprintf("%x", sha256.Sum256(goodPayload))
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("corrupted mirror object"))
	}))
	defer primary.Close()
	fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(goodPayload)
	}))
	defer fallback.Close()

	assetPath := filepath.Join(t.TempDir(), "GoNavi.bin")
	actualHash, err := downloadUpdateAssetWithFallback(
		[]string{primary.URL, fallback.URL},
		assetPath,
		expectedHash,
		nil,
	)
	if err != nil {
		t.Fatalf("expected checksum mismatch fallback to succeed: %v", err)
	}
	if actualHash != expectedHash {
		t.Fatalf("actual hash = %q, want %q", actualHash, expectedHash)
	}
	payload, err := os.ReadFile(assetPath)
	if err != nil {
		t.Fatalf("read downloaded asset: %v", err)
	}
	if string(payload) != string(goodPayload) {
		t.Fatalf("downloaded payload = %q", payload)
	}
}

func TestReleaseFromUpdateManifestMapsAssets(t *testing.T) {
	release := releaseFromUpdateManifest(&updateReleaseManifest{
		TagName:     "v1.2.3",
		Version:     "1.2.3",
		Name:        "GoNavi 1.2.3",
		HTMLURL:     "https://github.com/Syngnat/GoNavi/releases/tag/v1.2.3",
		PublishedAt: "2026-07-09T00:00:00Z",
		Assets: []updateManifestAsset{
			{
				Name:   "GoNavi-1.2.3-Windows-Amd64.exe",
				URL:    "https://example.com/app.exe",
				SHA256: "Aa" + strings.Repeat("b", 62),
				Size:   99,
			},
		},
	})
	if release == nil {
		t.Fatal("expected release")
	}
	if release.TagName != "v1.2.3" || len(release.Assets) != 1 {
		t.Fatalf("unexpected release: %#v", release)
	}
	if release.Assets[0].BrowserDownloadURL != "https://example.com/app.exe" {
		t.Fatalf("url = %q", release.Assets[0].BrowserDownloadURL)
	}
	if !strings.HasPrefix(release.Assets[0].Digest, "sha256:") {
		t.Fatalf("digest = %q", release.Assets[0].Digest)
	}
}

func TestUpdateManifestRemoteURLsPreferR2ThenGitHub(t *testing.T) {
	tests := []struct {
		channel updateChannel
		want    []string
	}{
		{updateChannelLatest, []string{updateMirrorLatestManifestURL, updateGitHubLatestManifestURL}},
		{updateChannelDev, []string{updateMirrorDevManifestURL, updateGitHubDevManifestURL}},
	}
	for _, test := range tests {
		got := updateManifestRemoteURLs(test.channel)
		if len(got) != len(test.want) {
			t.Fatalf("channel %s URLs = %v", test.channel, got)
		}
		for index := range test.want {
			if got[index] != test.want[index] {
				t.Fatalf("channel %s URLs = %v, want %v", test.channel, got, test.want)
			}
		}
	}
}

func TestFetchStaticUpdateManifestFromURLsFallsBackFromInvalidR2Manifests(t *testing.T) {
	for _, name := range []string{
		"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
		"http_proxy", "https_proxy", "all_proxy",
	} {
		t.Setenv(name, "")
	}
	t.Setenv("NO_PROXY", "127.0.0.1,localhost")
	t.Setenv("no_proxy", "127.0.0.1,localhost")
	t.Setenv("GONAVI_DATA_ROOT", t.TempDir())

	const version = "9.9.9"
	expectedAsset, err := expectedAssetNameForInstallMode(
		stdRuntime.GOOS,
		stdRuntime.GOARCH,
		version,
		updateResolveInstallMode(),
	)
	if err != nil {
		t.Fatalf("resolve expected update asset: %v", err)
	}
	valid := updateReleaseManifest{
		SchemaVersion: updateManifestSchemaVersion,
		Channel:       string(updateChannelLatest),
		TagName:       "v" + version,
		Version:       version,
		Assets: []updateManifestAsset{{
			Name:   expectedAsset,
			URL:    "https://download.example.test/" + expectedAsset,
			APIURL: "https://github.example.test/" + expectedAsset,
			Size:   123,
			SHA256: strings.Repeat("a", 64),
		}},
	}
	wrongChannel := valid
	wrongChannel.Channel = string(updateChannelDev)
	missingTarget := valid
	missingTarget.Assets = []updateManifestAsset{{
		Name:   "GoNavi-9.9.9-Other-Platform.bin",
		URL:    "https://download.example.test/other.bin",
		Size:   123,
		SHA256: strings.Repeat("b", 64),
	}}

	serveManifest := func(manifest updateReleaseManifest, hits *atomic.Int32) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			hits.Add(1)
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(manifest); err != nil {
				t.Errorf("encode manifest: %v", err)
			}
		}))
	}
	var wrongChannelHits atomic.Int32
	var missingTargetHits atomic.Int32
	var validHits atomic.Int32
	wrongChannelServer := serveManifest(wrongChannel, &wrongChannelHits)
	defer wrongChannelServer.Close()
	missingTargetServer := serveManifest(missingTarget, &missingTargetHits)
	defer missingTargetServer.Close()
	validServer := serveManifest(valid, &validHits)
	defer validServer.Close()

	release, err := fetchStaticUpdateManifestFromURLs(updateChannelLatest, []string{
		wrongChannelServer.URL,
		missingTargetServer.URL,
		validServer.URL,
	})
	if err != nil {
		t.Fatalf("expected valid fallback manifest: %v", err)
	}
	if release == nil || release.TagName != "v"+version || len(release.Assets) != 1 || release.Assets[0].Name != expectedAsset {
		t.Fatalf("unexpected fallback release: %#v", release)
	}
	if wrongChannelHits.Load() != 1 || missingTargetHits.Load() != 1 || validHits.Load() != 1 {
		t.Fatalf(
			"unexpected manifest request counts: wrong-channel=%d missing-target=%d valid=%d",
			wrongChannelHits.Load(),
			missingTargetHits.Load(),
			validHits.Load(),
		)
	}
}

func TestFetchFreshestStaticUpdateManifestFromURLsPrefersNewerDevPublishedAt(t *testing.T) {
	configureUpdateManifestHTTPTest(t)

	var mirrorHits atomic.Int32
	var githubHits atomic.Int32
	mirror := serveUpdateManifestForTest(t, buildValidUpdateManifestForTest(
		t, updateChannelDev, "dev-3e02c81", "2026-07-23T01:19:41Z", "a",
	), &mirrorHits)
	defer mirror.Close()
	github := serveUpdateManifestForTest(t, buildValidUpdateManifestForTest(
		t, updateChannelDev, "dev-83952ab", "2026-07-23T05:39:03Z", "b",
	), &githubHits)
	defer github.Close()

	release, err := fetchFreshestStaticUpdateManifestFromURLs(updateChannelDev, []string{mirror.URL, github.URL})
	if err != nil {
		t.Fatalf("fetch freshest static manifest: %v", err)
	}
	if got := resolveReleaseVersion(updateChannelDev, release); got != "dev-83952ab" {
		t.Fatalf("freshest dev version = %q, want dev-83952ab", got)
	}
	if mirrorHits.Load() != 1 || githubHits.Load() != 1 {
		t.Fatalf("manifest request counts: mirror=%d github=%d", mirrorHits.Load(), githubHits.Load())
	}
	cached, _ := loadDiskUpdateManifest(updateChannelDev)
	if cached == nil || cached.Version != "dev-83952ab" {
		t.Fatalf("cached manifest = %#v, want selected GitHub manifest", cached)
	}
}

func TestFetchFreshestStaticUpdateManifestFromURLsUsesAvailableSource(t *testing.T) {
	configureUpdateManifestHTTPTest(t)

	tests := []struct {
		name            string
		mirrorAvailable bool
		githubAvailable bool
		wantVersion     string
	}{
		{name: "mirror unavailable", githubAvailable: true, wantVersion: "dev-github"},
		{name: "github unavailable", mirrorAvailable: true, wantVersion: "dev-mirror"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mirror := serveUpdateManifestForTest(t, buildValidUpdateManifestForTest(
				t, updateChannelDev, "dev-mirror", "2026-07-23T01:00:00Z", "a",
			), nil)
			mirrorURL := mirror.URL
			if !test.mirrorAvailable {
				mirror.Close()
			} else {
				defer mirror.Close()
			}

			github := serveUpdateManifestForTest(t, buildValidUpdateManifestForTest(
				t, updateChannelDev, "dev-github", "2026-07-23T02:00:00Z", "b",
			), nil)
			githubURL := github.URL
			if !test.githubAvailable {
				github.Close()
			} else {
				defer github.Close()
			}

			release, err := fetchFreshestStaticUpdateManifestFromURLs(updateChannelDev, []string{mirrorURL, githubURL})
			if err != nil {
				t.Fatalf("fetch freshest static manifest: %v", err)
			}
			if got := resolveReleaseVersion(updateChannelDev, release); got != test.wantVersion {
				t.Fatalf("version = %q, want %q", got, test.wantVersion)
			}
		})
	}
}

func TestFetchFreshestStaticUpdateManifestFromURLsPrefersHigherStableVersion(t *testing.T) {
	configureUpdateManifestHTTPTest(t)

	mirror := serveUpdateManifestForTest(t, buildValidUpdateManifestForTest(
		t, updateChannelLatest, "2.4.9", "2026-07-23T05:00:00Z", "c",
	), nil)
	defer mirror.Close()
	github := serveUpdateManifestForTest(t, buildValidUpdateManifestForTest(
		t, updateChannelLatest, "2.5.0", "2026-07-23T04:00:00Z", "d",
	), nil)
	defer github.Close()

	release, err := fetchFreshestStaticUpdateManifestFromURLs(updateChannelLatest, []string{mirror.URL, github.URL})
	if err != nil {
		t.Fatalf("fetch freshest stable manifest: %v", err)
	}
	if got := resolveReleaseVersion(updateChannelLatest, release); got != "2.5.0" {
		t.Fatalf("stable version = %q, want 2.5.0", got)
	}
}

func TestFetchFreshestStaticUpdateManifestFromURLsFetchesSourcesConcurrently(t *testing.T) {
	configureUpdateManifestHTTPTest(t)

	entered := make(chan struct{}, 2)
	releaseHandlers := make(chan struct{})
	serveBlockedManifest := func(manifest updateReleaseManifest) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			entered <- struct{}{}
			<-releaseHandlers
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(manifest)
		}))
	}

	mirror := serveBlockedManifest(buildValidUpdateManifestForTest(
		t, updateChannelDev, "dev-mirror", "2026-07-23T01:00:00Z", "e",
	))
	defer mirror.Close()
	github := serveBlockedManifest(buildValidUpdateManifestForTest(
		t, updateChannelDev, "dev-github", "2026-07-23T02:00:00Z", "f",
	))
	defer github.Close()

	type fetchOutcome struct {
		release *githubRelease
		err     error
	}
	done := make(chan fetchOutcome, 1)
	go func() {
		release, err := fetchFreshestStaticUpdateManifestFromURLs(updateChannelDev, []string{mirror.URL, github.URL})
		done <- fetchOutcome{release: release, err: err}
	}()

	for index := 0; index < 2; index++ {
		select {
		case <-entered:
		case <-time.After(2 * time.Second):
			close(releaseHandlers)
			t.Fatal("static manifest sources were not fetched concurrently")
		}
	}
	close(releaseHandlers)
	outcome := <-done
	if outcome.err != nil {
		t.Fatalf("fetch freshest static manifest: %v", outcome.err)
	}
	if got := resolveReleaseVersion(updateChannelDev, outcome.release); got != "dev-github" {
		t.Fatalf("version = %q, want dev-github", got)
	}
}

func TestDiskUpdateManifestRoundTrip(t *testing.T) {
	root := t.TempDir()
	t.Setenv("GONAVI_DATA_ROOT", root)

	payload := &updateReleaseManifest{
		SchemaVersion: 1,
		Channel:       "latest",
		TagName:       "v9.9.9",
		Version:       "9.9.9",
		Name:          "v9.9.9",
		HTMLURL:       "https://github.com/Syngnat/GoNavi/releases/tag/v9.9.9",
		Assets: []updateManifestAsset{
			{Name: "app.bin", URL: "https://example.com/app.bin", SHA256: strings.Repeat("c", 64), Size: 1},
		},
		FetchedAt: time.Now().UTC(),
	}
	storeDiskUpdateManifest(updateChannelLatest, payload)
	loaded, stale := loadDiskUpdateManifest(updateChannelLatest)
	if loaded == nil || stale {
		t.Fatalf("expected fresh disk cache, got %#v stale=%v", loaded, stale)
	}
	if loaded.Version != "9.9.9" {
		t.Fatalf("version = %q", loaded.Version)
	}
	path := updateManifestCachePath(updateChannelLatest)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("cache file missing: %v", err)
	}
	if !strings.HasPrefix(path, root) {
		t.Fatalf("cache path not under data root: %s", path)
	}
}

func TestFetchReleaseForChannelPreferringStaticUsesStaticFirst(t *testing.T) {
	root := t.TempDir()
	t.Setenv("GONAVI_DATA_ROOT", root)
	updateReleaseCache = sync.Map{}

	staticCalled := false
	apiCalled := false
	restoreStatic := swapUpdateFetchStaticManifest(func(channel updateChannel) (*githubRelease, error) {
		staticCalled = true
		return &githubRelease{TagName: "v2.0.0", Name: "v2.0.0"}, nil
	})
	defer restoreStatic()
	restoreAPI := swapUpdateFetchLatestRelease(func() (*githubRelease, error) {
		apiCalled = true
		return nil, errors.New("api should not be called")
	})
	defer restoreAPI()

	release, err := fetchReleaseForChannelPreferringStatic(updateChannelLatest, true)
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if !staticCalled || apiCalled {
		t.Fatalf("staticCalled=%v apiCalled=%v", staticCalled, apiCalled)
	}
	if release.TagName != "v2.0.0" {
		t.Fatalf("tag=%q", release.TagName)
	}
}

func TestFetchReleaseForChannelPreferringStaticUsesFreshestOnlyForManualChecks(t *testing.T) {
	t.Setenv("GONAVI_DATA_ROOT", t.TempDir())
	updateReleaseCache = sync.Map{}
	updateNetworkCheckMu.Lock()
	updateLastNetworkCheck = updateNetworkCheckMemory{}
	updateNetworkCheckMu.Unlock()

	staticCalls := 0
	freshestCalls := 0
	restoreStatic := swapUpdateFetchStaticManifest(func(channel updateChannel) (*githubRelease, error) {
		staticCalls++
		return &githubRelease{TagName: updateDevReleaseTag, Name: "Dev Build (dev-mirror)"}, nil
	})
	defer restoreStatic()
	restoreFreshest := swapUpdateFetchFreshestStaticManifest(func(channel updateChannel) (*githubRelease, error) {
		freshestCalls++
		return &githubRelease{TagName: updateDevReleaseTag, Name: "Dev Build (dev-github)"}, nil
	})
	defer restoreFreshest()

	silentRelease, err := fetchReleaseForChannelPreferringStatic(updateChannelDev, false)
	if err != nil {
		t.Fatalf("silent static fetch: %v", err)
	}
	if got := resolveReleaseVersion(updateChannelDev, silentRelease); got != "dev-mirror" {
		t.Fatalf("silent version = %q, want mirror", got)
	}
	if staticCalls != 1 || freshestCalls != 0 {
		t.Fatalf("silent calls: static=%d freshest=%d", staticCalls, freshestCalls)
	}

	manualRelease, err := fetchReleaseForChannelPreferringStatic(updateChannelDev, true)
	if err != nil {
		t.Fatalf("manual static fetch: %v", err)
	}
	if got := resolveReleaseVersion(updateChannelDev, manualRelease); got != "dev-github" {
		t.Fatalf("manual version = %q, want freshest", got)
	}
	if staticCalls != 1 || freshestCalls != 1 {
		t.Fatalf("manual calls: static=%d freshest=%d", staticCalls, freshestCalls)
	}
}

func TestFetchReleaseForChannelPreferringStaticFallsBackAPIThenDisk(t *testing.T) {
	root := t.TempDir()
	t.Setenv("GONAVI_DATA_ROOT", root)
	updateReleaseCache = sync.Map{}

	storeDiskUpdateManifest(updateChannelLatest, &updateReleaseManifest{
		SchemaVersion: 1,
		TagName:       "v1.0.0",
		Version:       "1.0.0",
		Assets:        []updateManifestAsset{{Name: "a", URL: "https://example.com/a"}},
		FetchedAt:     time.Now().UTC(),
	})

	restoreStatic := swapUpdateFetchStaticManifest(func(channel updateChannel) (*githubRelease, error) {
		return nil, errors.New("static 404")
	})
	defer restoreStatic()
	restoreAPI := swapUpdateFetchLatestRelease(func() (*githubRelease, error) {
		return nil, errors.New("api rate limit")
	})
	defer restoreAPI()

	release, err := fetchReleaseForChannelPreferringStatic(updateChannelLatest, true)
	if err != nil {
		t.Fatalf("expected disk fallback, err=%v", err)
	}
	if release.TagName != "v1.0.0" {
		t.Fatalf("tag=%q", release.TagName)
	}
}

func TestSilentCheckThrottleReusesDisk(t *testing.T) {
	root := t.TempDir()
	t.Setenv("GONAVI_DATA_ROOT", root)
	updateReleaseCache = sync.Map{}
	storeDiskUpdateManifest(updateChannelLatest, &updateReleaseManifest{
		SchemaVersion: 1,
		TagName:       "v3.0.0",
		Version:       "3.0.0",
		Assets:        []updateManifestAsset{{Name: "a", URL: "u"}},
		FetchedAt:     time.Now().UTC(),
	})
	markUpdateNetworkCheck(updateChannelLatest)

	staticCalls := 0
	restoreStatic := swapUpdateFetchStaticManifest(func(channel updateChannel) (*githubRelease, error) {
		staticCalls++
		return nil, errors.New("should not hit network")
	})
	defer restoreStatic()
	restoreAPI := swapUpdateFetchLatestRelease(func() (*githubRelease, error) {
		t.Fatal("api should not be called during throttle")
		return nil, nil
	})
	defer restoreAPI()

	release, err := fetchReleaseForChannelPreferringStatic(updateChannelLatest, false)
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if release.TagName != "v3.0.0" {
		t.Fatalf("tag=%q", release.TagName)
	}
	if staticCalls != 0 {
		t.Fatalf("staticCalls=%d", staticCalls)
	}
}

func TestUpdateManifestFromGitHubRelease(t *testing.T) {
	release := &githubRelease{
		TagName: "v1.0.1",
		Name:    "v1.0.1",
		HTMLURL: "https://github.com/Syngnat/GoNavi/releases/tag/v1.0.1",
		Assets: []githubAsset{
			{Name: "a.exe", BrowserDownloadURL: "https://x/a.exe", Digest: "sha256:" + strings.Repeat("d", 64), Size: 10},
		},
	}
	m := updateManifestFromGitHubRelease(updateChannelLatest, release, nil)
	if m == nil || m.Version == "" || len(m.Assets) != 1 {
		t.Fatalf("manifest=%#v", m)
	}
	_ = json.Marshal
}
