package market

import (
	"context"
	"errors"
	"testing"
)

type stubReleases struct {
	release ReleaseSource
	archive []byte
	err     error
}

func (s *stubReleases) LatestRelease(ctx context.Context, owner, repo string) (ReleaseSource, error) {
	if s.err != nil {
		return ReleaseSource{}, s.err
	}
	return s.release, nil
}

func (s *stubReleases) FetchAsset(ctx context.Context, url string) ([]byte, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.archive, nil
}

const testSourceURL = "https://github.com/acme/tool"

// submitWithSource publishes one version while registering the repository the
// sync pass should track.
func submitWithSource(t *testing.T, f *httpFixture, version string, payload []byte) {
	t.Helper()
	response := f.upload(t, "acme.example", version, "publisher", payload, map[string]string{"source": testSourceURL})
	assertStatus(t, response, 201)
}

func TestSyncPublishesNewerRelease(t *testing.T) {
	newer := archiveFixture(t, "acme.example", "1.1.0", "")
	f := newSyncFixture(t, &stubReleases{release: ReleaseSource{Owner: "acme", Repo: "tool", Tag: "v1.1.0", AssetURL: "u", AssetName: "tool.zip"}, archive: newer})
	submitWithSource(t, f, "1.0.0", archiveFixture(t, "acme.example", "1.0.0", ""))
	outcomes := decodeResponse[[]SyncOutcome](t, f.request("POST", "/admin/sync", "admin", nil))
	if len(outcomes) != 1 || !outcomes[0].Published || outcomes[0].Version != "1.1.0" {
		t.Fatalf("outcomes=%+v", outcomes)
	}
	published := decodeResponse[MarketPlugin](t, f.request("GET", "/plugins/acme.example", "", nil))
	if published.Version != "1.1.0" || published.SourceURL != testSourceURL {
		t.Fatalf("published=%+v", published)
	}
	download := f.request("GET", "/artifacts/"+artifactTestDigest(newer), "", nil)
	assertStatus(t, download, 200)
}

func TestSyncSkipsSameVersion(t *testing.T) {
	f := newSyncFixture(t, &stubReleases{release: ReleaseSource{Owner: "acme", Repo: "tool", Tag: "v1.0.0", AssetURL: "u", AssetName: "tool.zip"},
		archive: archiveFixture(t, "acme.example", "1.0.0", "")})
	submitWithSource(t, f, "1.0.0", archiveFixture(t, "acme.example", "1.0.0", ""))
	outcomes := decodeResponse[[]SyncOutcome](t, f.request("POST", "/admin/sync", "admin", nil))
	if len(outcomes) != 1 || !outcomes[0].Skipped || outcomes[0].Published {
		t.Fatalf("outcomes=%+v", outcomes)
	}
	published := decodeResponse[MarketPlugin](t, f.request("GET", "/plugins/acme.example", "", nil))
	if published.Version != "1.0.0" {
		t.Fatalf("same version republished: %+v", published)
	}
}

func TestSyncRejectsForeignManifest(t *testing.T) {
	f := newSyncFixture(t, &stubReleases{release: ReleaseSource{Owner: "acme", Repo: "tool", Tag: "v2.0.0", AssetURL: "u", AssetName: "tool.zip"},
		archive: archiveFixture(t, "other.plugin", "2.0.0", "")})
	submitWithSource(t, f, "1.0.0", archiveFixture(t, "acme.example", "1.0.0", ""))
	outcomes := decodeResponse[[]SyncOutcome](t, f.request("POST", "/admin/sync", "admin", nil))
	if len(outcomes) != 1 || !outcomes[0].Skipped || outcomes[0].Reason != "release manifest belongs to another plugin" {
		t.Fatalf("outcomes=%+v", outcomes)
	}
	if published := decodeResponse[MarketPlugin](t, f.request("GET", "/plugins/acme.example", "", nil)); published.Version != "1.0.0" {
		t.Fatal("foreign manifest replaced the published version")
	}
}

func TestSyncReleaseUnavailableKeepsPublishedVersion(t *testing.T) {
	f := newSyncFixture(t, &stubReleases{err: errors.New("github down")})
	submitWithSource(t, f, "1.0.0", archiveFixture(t, "acme.example", "1.0.0", ""))
	outcomes := decodeResponse[[]SyncOutcome](t, f.request("POST", "/admin/sync", "admin", nil))
	if len(outcomes) != 1 || !outcomes[0].Skipped || outcomes[0].Reason != "release unavailable" {
		t.Fatalf("outcomes=%+v", outcomes)
	}
	if published := decodeResponse[MarketPlugin](t, f.request("GET", "/plugins/acme.example", "", nil)); published.Version != "1.0.0" {
		t.Fatal("unavailable release disturbed the published version")
	}
}

func TestSyncRequiresAdministrator(t *testing.T) {
	f := newSyncFixture(t, &stubReleases{})
	assertStatus(t, f.request("POST", "/admin/sync", "publisher", nil), 403)
	assertStatus(t, f.request("POST", "/admin/sync", "", nil), 401)
}

func TestParseRepositoryURL(t *testing.T) {
	if _, _, err := parseRepositoryURL("https://gitlab.com/acme/tool"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v", err)
	}
	if _, _, err := parseRepositoryURL("https://github.com/acme/tool/extra"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v", err)
	}
	owner, repo, err := parseRepositoryURL("https://github.com/Acme-Org/tool/")
	if err != nil || owner != "Acme-Org" || repo != "tool" {
		t.Fatalf("owner=%q repo=%q err=%v", owner, repo, err)
	}
}

func TestCompareSemver(t *testing.T) {
	cases := []struct {
		left, right string
		want        int
	}{
		{"1.0.0", "1.0.1", -1},
		{"v1.2.0", "1.2.0", 0},
		{"1.0.0+build", "1.0.0", 0},
		{"1.0.0-rc.1", "1.0.0", -1},
		{"1.0.0-rc.9", "1.0.0-rc.10", -1},
		{"1.0.0-1", "1.0.0-alpha", -1},
		{"", "1.0.0", 0},
		{"1.10.0", "1.9.0", 1},
	}
	for _, c := range cases {
		if got := compareSemver(c.left, c.right); got != c.want {
			t.Fatalf("compare(%q,%q)=%d want %d", c.left, c.right, got, c.want)
		}
	}
}
