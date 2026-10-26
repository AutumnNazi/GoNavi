package market

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type exactReleaseStub struct {
	release ReleaseSource
	archive []byte
	err     error
}

func (s *exactReleaseStub) Release(context.Context, RepositoryRef) (ReleaseSource, error) {
	return s.release, s.err
}

func (s *exactReleaseStub) LatestRelease(context.Context, string, string) (ReleaseSource, error) {
	return s.release, s.err
}

func (s *exactReleaseStub) FetchAsset(context.Context, string) ([]byte, error) {
	return s.archive, s.err
}

func newReleaseFixture(t *testing.T, release ReleaseSource, archive []byte) *httpFixture {
	t.Helper()
	f := newHTTPFixture(t)
	if err := f.server.setReleaseFetcher(&exactReleaseStub{release: release, archive: archive}); err != nil {
		t.Fatal(err)
	}
	return f
}

func releaseSource(tag string) ReleaseSource {
	return ReleaseSource{Owner: "acme", Repo: "tool", Tag: tag,
		ReleaseURL: "https://github.com/acme/tool/releases/tag/" + tag,
		AssetURL:   "https://github.com/acme/tool/releases/download/" + tag + "/tool.zip",
		AssetName:  "tool.zip"}
}

func TestReleasePublishInspectsAndPublishesExactRelease(t *testing.T) {
	archive := archiveFixture(t, "acme.example", "1.2.0", "1.1.5")
	f := newReleaseFixture(t, releaseSource("market-acme-example-v1.2.0"), archive)
	body := `{"sourceUrl":"https://github.com/acme/tool/releases/tag/market-acme-example-v1.2.0"}`
	inspect := f.request("POST", "/publisher/release/inspect", "publisher", strings.NewReader(body))
	assertStatus(t, inspect, 200)
	preview := decodeResponse[ReleaseInspection](t, inspect)
	if !preview.CanPublish || preview.PluginID != "acme.example" || preview.Version != "1.2.0" ||
		preview.SHA256 != payloadDigest(archive) || preview.SourceURL != "https://github.com/acme/tool" ||
		preview.ReleaseTag != "market-acme-example-v1.2.0" || preview.AssetName != "tool.zip" {
		t.Fatalf("inspection=%+v", preview)
	}
	if len(f.repo.releases) != 0 {
		t.Fatal("release inspection persisted a submission")
	}
	publishBody := `{"sourceUrl":"https://github.com/acme/tool/releases/tag/market-acme-example-v1.2.0","expectedDigest":"` + preview.SHA256 + `"}`
	published := f.request("POST", "/publisher/release/publish", "publisher", strings.NewReader(publishBody))
	assertStatus(t, published, 201)
	submission := decodeResponse[Submission](t, published)
	if submission.State != "published" || submission.PluginID != "acme.example" || submission.Version != "1.2.0" || submission.Warning != "" {
		t.Fatalf("submission=%+v", submission)
	}
	detail := decodeResponse[MarketPlugin](t, f.request("GET", "/plugins/acme.example", "", nil))
	if detail.SourceURL != "https://github.com/acme/tool" || detail.Version != "1.2.0" {
		t.Fatalf("detail=%+v", detail)
	}
}

func TestSourceRegistrationAvoidsOfficialMonorepoLatest(t *testing.T) {
	archive := archiveFixture(t, "gh-publisher.example", "1.0.0", "")
	f := newReleaseFixture(t, ReleaseSource{Owner: "Syngnat", Repo: "GoNavi-Plugin-Market", Tag: "example-v1.0.0",
		ReleaseURL: "https://github.com/Syngnat/GoNavi-Plugin-Market/releases/tag/example-v1.0.0",
		AssetURL:   "https://github.com/Syngnat/GoNavi-Plugin-Market/releases/download/example-v1.0.0/example.zip",
		AssetName:  "example.zip"}, archive)
	f.repo.accounts["1"] = Account{ID: "1", Login: "author", Role: "publisher", PublisherID: "gh-publisher"}
	body := `{"sourceUrl":"https://github.com/Syngnat/GoNavi-Plugin-Market/releases/tag/example-v1.0.0","expectedDigest":"` + payloadDigest(archive) + `"}`
	response := f.request("POST", "/publisher/release/publish", "publisher", strings.NewReader(body))
	assertStatus(t, response, 201)
	page := decodeResponse[PublisherPluginPage](t, f.request("GET", "/publisher/plugins?pluginId=gh-publisher.example", "publisher", nil))
	if len(page.Items) != 1 || page.Items[0].SourceURL != "" {
		t.Fatalf("monorepo source must remain explicit-only: %+v", page)
	}
}

func TestSingleRepositoryRootRegistersAutoSyncSource(t *testing.T) {
	archive := archiveFixture(t, "acme.example", "1.0.0", "")
	f := newReleaseFixture(t, releaseSource("v1.0.0"), archive)
	body := `{"sourceUrl":"https://github.com/acme/tool","expectedDigest":"` + payloadDigest(archive) + `"}`
	assertStatus(t, f.request("POST", "/publisher/release/publish", "publisher", strings.NewReader(body)), 201)
	page := decodeResponse[PublisherPluginPage](t, f.request("GET", "/publisher/plugins?pluginId=acme.example", "publisher", nil))
	if len(page.Items) != 1 || page.Items[0].SourceURL != "https://github.com/acme/tool" {
		t.Fatalf("single repository source not registered: %+v", page)
	}
}

func TestReleasePublishBareRepoUsesLatestAndEnforcesNamespace(t *testing.T) {
	archive := archiveFixture(t, "foreign.example", "1.0.0", "")
	f := newReleaseFixture(t, releaseSource("v1.0.0"), archive)
	inspect := f.request("POST", "/publisher/release/inspect", "publisher", strings.NewReader(`{"sourceUrl":"https://github.com/acme/tool"}`))
	assertStatus(t, inspect, 200)
	preview := decodeResponse[ReleaseInspection](t, inspect)
	if preview.CanPublish || preview.Reason != "forbidden" {
		t.Fatalf("preview=%+v", preview)
	}
	publish := f.request("POST", "/publisher/release/publish", "publisher",
		strings.NewReader(`{"sourceUrl":"https://github.com/acme/tool","expectedDigest":"`+payloadDigest(archive)+`"}`))
	assertStatus(t, publish, 403)
	if len(f.repo.releases) != 0 {
		t.Fatal("foreign namespace persisted a submission")
	}
}

func TestReleasePublishRejectsChangedDigestAndMalformedReference(t *testing.T) {
	archive := archiveFixture(t, "acme.example", "1.0.0", "")
	f := newReleaseFixture(t, releaseSource("v1.0.0"), archive)
	changed := f.request("POST", "/publisher/release/publish", "publisher",
		strings.NewReader(`{"sourceUrl":"https://github.com/acme/tool","expectedDigest":"`+strings.Repeat("a", 64)+`"}`))
	assertStatus(t, changed, 409)
	if failure := decodeResponse[APIError](t, changed); failure.Code != "inspection_changed" {
		t.Fatalf("failure=%+v", failure)
	}
	for _, source := range []string{
		"http://github.com/acme/tool",
		"https://gitlab.com/acme/tool",
		"https://github.com/acme/tool/tree/main/plugins/example",
	} {
		invalid := f.request("POST", "/publisher/release/inspect", "publisher", strings.NewReader(`{"sourceUrl":"`+source+`"}`))
		assertStatus(t, invalid, 400)
	}
}

func TestParseReleaseReference(t *testing.T) {
	cases := []struct {
		raw, owner, repo, tag, asset string
	}{
		{"https://github.com/Syngnat/GoNavi-Plugin-Market", "Syngnat", "GoNavi-Plugin-Market", "", ""},
		{"https://github.com/Syngnat/GoNavi-Plugin-Market/releases/tag/nginx-inspector-v1.0.0", "Syngnat", "GoNavi-Plugin-Market", "nginx-inspector-v1.0.0", ""},
		{"https://github.com/acme/tool/releases/download/v1.0.0/tool.zip", "acme", "tool", "v1.0.0", "tool.zip"},
	}
	for _, c := range cases {
		ref, err := parseReleaseReference(c.raw)
		if err != nil || ref.Owner != c.owner || ref.Repo != c.repo || ref.Tag != c.tag || ref.AssetName != c.asset {
			t.Fatalf("parse(%q)=%+v err=%v", c.raw, ref, err)
		}
	}
	if _, err := parseReleaseReference("https://github.com/acme/tool/issues"); !errors.Is(err, ErrInvalid) {
		t.Fatal("issue URL accepted")
	}
}

func TestReleasePreflightRequiresAuthenticationAndFetcher(t *testing.T) {
	f := newHTTPFixture(t)
	assertStatus(t, f.request("POST", "/publisher/release/inspect", "", strings.NewReader(`{"sourceUrl":"https://github.com/acme/tool"}`)), 401)
	response := f.request("POST", "/publisher/release/inspect", "publisher", strings.NewReader(`{"sourceUrl":"https://github.com/acme/tool"}`))
	assertStatus(t, response, 400)
}

func TestOfficialMonorepoRequiresExplicitRelease(t *testing.T) {
	archive := archiveFixture(t, "com.gonavi.example", "1.0.0", "")
	f := newReleaseFixture(t, releaseSource("nginx-inspector-v1.0.0"), archive)
	response := f.request("POST", "/publisher/release/inspect", "publisher",
		strings.NewReader(`{"sourceUrl":"https://github.com/Syngnat/GoNavi-Plugin-Market"}`))
	assertStatus(t, response, 400)
	if failure := decodeResponse[APIError](t, response); failure.Code != "release_required" {
		t.Fatalf("failure=%+v", failure)
	}
	explicit := f.request("POST", "/publisher/release/inspect", "publisher",
		strings.NewReader(`{"sourceUrl":"https://github.com/Syngnat/GoNavi-Plugin-Market/releases/tag/nginx-inspector-v1.0.0"}`))
	assertStatus(t, explicit, 200)
	if report := decodeResponse[ReleaseInspection](t, explicit); report.ReleaseTag != "nginx-inspector-v1.0.0" {
		t.Fatalf("report=%+v", report)
	}
}
