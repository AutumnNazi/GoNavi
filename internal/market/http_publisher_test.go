package market

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func multipartArchiveRequest(t *testing.T, method, path string, fields map[string]string, archive []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	part, err := writer.CreateFormFile("package", "plugin.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(archive); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(method, "http://localhost:8090/api/v1"+path, &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request
}

func (f *httpFixture) send(request *http.Request, role string) *httptest.ResponseRecorder {
	if role != "" {
		request.Header.Set("Authorization", "Bearer "+f.tokens[role])
	}
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, request)
	return response
}

func payloadDigest(payload []byte) string {
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:])
}

func TestPublisherInspectReportsPackageWithoutPersisting(t *testing.T) {
	f := newHTTPFixture(t)
	payload := archiveFixture(t, "acme.demo", "1.0.0", "1.1.5")
	response := f.send(multipartArchiveRequest(t, "POST", "/publisher/inspect", nil, payload), "publisher")
	assertStatus(t, response, 200)
	report := decodeResponse[PackageInspection](t, response)
	if !report.CanPublish || report.Reason != "" {
		t.Fatalf("report=%+v", report)
	}
	if report.PluginID != "acme.demo" || report.Version != "1.0.0" || report.Name != "Example" || report.Category != "other" {
		t.Fatalf("identity=%+v", report)
	}
	if report.MinHostVersion != "1.1.5" || len(report.Platforms) != 1 || report.Platforms[0] != "any" {
		t.Fatalf("platforms=%+v", report)
	}
	if report.SizeBytes != int64(len(payload)) || report.SHA256 != payloadDigest(payload) || len(report.Manifest) == 0 {
		t.Fatalf("artifact=%+v", report)
	}
	if len(f.repo.releases) != 0 {
		t.Fatal("inspect persisted a submission")
	}
	assertStatus(t, f.request("GET", "/plugins/acme.demo", "", nil), 404)
}

func TestPublisherInspectForbiddenAndInvalid(t *testing.T) {
	f := newHTTPFixture(t)
	foreign := archiveFixture(t, "evil.demo", "1.0.0", "")
	response := f.send(multipartArchiveRequest(t, "POST", "/publisher/inspect", nil, foreign), "publisher")
	assertStatus(t, response, 200)
	report := decodeResponse[PackageInspection](t, response)
	if report.CanPublish || report.Reason != "forbidden" || report.PluginID != "evil.demo" {
		t.Fatalf("report=%+v", report)
	}
	broken := f.send(multipartArchiveRequest(t, "POST", "/publisher/inspect", nil, []byte("not a package")), "publisher")
	assertStatus(t, broken, 400)
	if failure := decodeResponse[APIError](t, broken); failure.Code != "artifact_invalid" {
		t.Fatalf("failure=%+v", failure)
	}
	noNamespace := f.send(multipartArchiveRequest(t, "POST", "/publisher/inspect", nil, archiveFixture(t, "acme.demo", "1.0.0", "")), "user")
	assertStatus(t, noNamespace, 200)
	if report := decodeResponse[PackageInspection](t, noNamespace); report.CanPublish || report.Reason != "forbidden" {
		t.Fatalf("reader report=%+v", report)
	}
	assertStatus(t, f.send(multipartArchiveRequest(t, "POST", "/publisher/inspect", nil, archiveFixture(t, "acme.demo", "1.0.0", "")), ""), 401)
}

func TestPublisherInspectRequiresCSRFForCookieSessions(t *testing.T) {
	f := newHTTPFixture(t)
	cookie, token := browserSessionFor(t, f, "1")
	payload := archiveFixture(t, "acme.demo", "1.0.0", "")
	request := multipartArchiveRequest(t, "POST", "/publisher/inspect", nil, payload)
	request.AddCookie(cookie)
	assertStatus(t, f.send(request, ""), 403)
	request = multipartArchiveRequest(t, "POST", "/publisher/inspect", nil, payload)
	request.AddCookie(cookie)
	request.Header.Set("X-GoNavi-CSRF", token)
	response := f.send(request, "")
	assertStatus(t, response, 200)
	if !decodeResponse[PackageInspection](t, response).CanPublish {
		t.Fatal("cookie-authenticated inspect was refused")
	}
}

func TestPublisherPluginAndSubmissionLists(t *testing.T) {
	f := newHTTPFixture(t)
	f.publish(t, "acme.alpha", "1.0.0", "")
	f.publish(t, "acme.beta", "1.0.0", "")
	first := decodeResponse[PublisherPluginPage](t, f.request("GET", "/publisher/plugins?limit=1", "publisher", nil))
	if len(first.Items) != 1 || first.Items[0].ID != "acme.alpha" || first.NextCursor == "" {
		t.Fatalf("first=%+v", first)
	}
	item := first.Items[0]
	if item.Name != "Example" || item.LatestVersion != "1.0.0" || item.LatestState != "published" || item.PublishedVersion != "1.0.0" || item.SourceURL != "" {
		t.Fatalf("item=%+v", item)
	}
	second := decodeResponse[PublisherPluginPage](t, f.request("GET", "/publisher/plugins?limit=1&cursor="+first.NextCursor, "publisher", nil))
	if len(second.Items) != 1 || second.Items[0].ID != "acme.beta" || second.NextCursor != "" {
		t.Fatalf("second=%+v", second)
	}
	filtered := decodeResponse[PublisherPluginPage](t, f.request("GET", "/publisher/plugins?pluginId=acme.beta", "publisher", nil))
	if len(filtered.Items) != 1 || filtered.Items[0].ID != "acme.beta" {
		t.Fatalf("filtered=%+v", filtered)
	}
	empty := f.request("GET", "/publisher/plugins?pluginId=acme.missing", "publisher", nil)
	assertStatus(t, empty, 200)
	if !strings.Contains(empty.Body.String(), `"items":[]`) {
		t.Fatalf("empty page is not an empty array: %s", empty.Body.String())
	}
	for _, query := range []string{"?limit=0", "?limit=51", "?limit=abc", "?cursor=!!", "?pluginId=ACME.BAD"} {
		assertStatus(t, f.request("GET", "/publisher/plugins"+query, "publisher", nil), 400)
	}
	assertStatus(t, f.request("GET", "/publisher/plugins", "", nil), 401)
	reader := f.request("GET", "/publisher/plugins", "user", nil)
	assertStatus(t, reader, 200)
	if !strings.Contains(reader.Body.String(), `"items":[]`) {
		t.Fatalf("reader page leaked plugins: %s", reader.Body.String())
	}

	submissions := decodeResponse[PublisherSubmissionPage](t, f.request("GET", "/publisher/submissions", "publisher", nil))
	if len(submissions.Items) != 2 || submissions.Items[0].State != "published" || len(submissions.Items[0].SHA256) != 64 {
		t.Fatalf("submissions=%+v", submissions)
	}
	onlyAlpha := decodeResponse[PublisherSubmissionPage](t, f.request("GET", "/publisher/submissions?pluginId=acme.alpha", "publisher", nil))
	if len(onlyAlpha.Items) != 1 || onlyAlpha.Items[0].PluginID != "acme.alpha" {
		t.Fatalf("filtered submissions=%+v", onlyAlpha)
	}
	paged := decodeResponse[PublisherSubmissionPage](t, f.request("GET", "/publisher/submissions?limit=1", "publisher", nil))
	if len(paged.Items) != 1 || paged.NextCursor == "" {
		t.Fatalf("paged submissions=%+v", paged)
	}
	rest := decodeResponse[PublisherSubmissionPage](t, f.request("GET", "/publisher/submissions?limit=1&cursor="+paged.NextCursor, "publisher", nil))
	if len(rest.Items) != 1 || rest.NextCursor != "" {
		t.Fatalf("rest submissions=%+v", rest)
	}
}

func TestPublisherPluginsLatestVersusPublished(t *testing.T) {
	f := newHTTPFixture(t)
	f.publish(t, "acme.alpha", "1.0.0", "")
	owner := f.repo.accounts["1"]
	if _, err := f.repo.BeginSubmission(context.Background(), owner, "acme.alpha", "2.0.0"); err != nil {
		t.Fatal(err)
	}
	page := decodeResponse[PublisherPluginPage](t, f.request("GET", "/publisher/plugins?pluginId=acme.alpha", "publisher", nil))
	if len(page.Items) != 1 {
		t.Fatalf("page=%+v", page)
	}
	item := page.Items[0]
	if item.LatestVersion != "2.0.0" || item.LatestState != "draft" || item.PublishedVersion != "1.0.0" || item.Name != "Example" {
		t.Fatalf("item=%+v", item)
	}
}

func TestPublisherSourceUpdateAndClear(t *testing.T) {
	f := newHTTPFixture(t)
	f.publish(t, "acme.example", "1.0.0", "")
	repository := "https://github.com/acme/example"
	response := f.request("PUT", "/publisher/plugins/acme.example/source", "publisher", strings.NewReader(`{"sourceUrl":"`+repository+`"}`))
	assertStatus(t, response, 200)
	if body := decodeResponse[map[string]string](t, response); body["sourceUrl"] != repository {
		t.Fatalf("body=%+v", body)
	}
	page := decodeResponse[PublisherPluginPage](t, f.request("GET", "/publisher/plugins?pluginId=acme.example", "publisher", nil))
	if len(page.Items) != 1 || page.Items[0].SourceURL != repository {
		t.Fatalf("page=%+v", page)
	}
	cleared := f.request("PUT", "/publisher/plugins/acme.example/source", "publisher", strings.NewReader(`{"sourceUrl":""}`))
	assertStatus(t, cleared, 200)
	page = decodeResponse[PublisherPluginPage](t, f.request("GET", "/publisher/plugins?pluginId=acme.example", "publisher", nil))
	if len(page.Items) != 1 || page.Items[0].SourceURL != "" {
		t.Fatalf("clear kept sourceUrl: %+v", page)
	}
	assertStatus(t, f.request("PUT", "/publisher/plugins/acme.example/source", "publisher", strings.NewReader(`{"sourceUrl":"https://gitlab.com/acme/example"}`)), 400)
	assertStatus(t, f.request("PUT", "/publisher/plugins/acme.example/source", "publisher", strings.NewReader(`{"sourceUrl":42}`)), 400)
	assertStatus(t, f.request("PUT", "/publisher/plugins/acme.example/source", "admin", strings.NewReader(`{"sourceUrl":"https://github.com/acme/example"}`)), 404)
	assertStatus(t, f.request("PUT", "/publisher/plugins/ACME.example/source", "publisher", strings.NewReader(`{"sourceUrl":"https://github.com/acme/example"}`)), 404)

	cookie, token := browserSessionFor(t, f, "1")
	request := httptest.NewRequest("PUT", "http://localhost:8090/api/v1/publisher/plugins/acme.example/source", strings.NewReader(`{"sourceUrl":"https://github.com/acme/example"}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(cookie)
	assertStatus(t, f.send(request, ""), 403)
	request = httptest.NewRequest("PUT", "http://localhost:8090/api/v1/publisher/plugins/acme.example/source", strings.NewReader(`{"sourceUrl":"https://github.com/acme/example"}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(cookie)
	request.Header.Set("X-GoNavi-CSRF", token)
	assertStatus(t, f.send(request, ""), 200)
}

func TestSubmissionExpectedDigestGuardsUpload(t *testing.T) {
	f := newHTTPFixture(t)
	payload := archiveFixture(t, "acme.example", "1.0.0", "")
	fields := map[string]string{"pluginId": "acme.example", "version": "1.0.0", "expectedDigest": strings.Repeat("a", 64)}
	response := f.send(multipartArchiveRequest(t, "POST", "/submissions", fields, payload), "publisher")
	assertStatus(t, response, 409)
	if failure := decodeResponse[APIError](t, response); failure.Code != "inspection_changed" {
		t.Fatalf("failure=%+v", failure)
	}
	submissions := decodeResponse[PublisherSubmissionPage](t, f.request("GET", "/publisher/submissions", "publisher", nil))
	if len(submissions.Items) != 0 {
		t.Fatalf("digest mismatch persisted a submission: %+v", submissions)
	}
	plugins := decodeResponse[PublisherPluginPage](t, f.request("GET", "/publisher/plugins", "publisher", nil))
	if len(plugins.Items) != 0 {
		t.Fatalf("digest mismatch reserved a plugin: %+v", plugins)
	}
	fields["expectedDigest"] = payloadDigest(payload)
	published := f.send(multipartArchiveRequest(t, "POST", "/submissions", fields, payload), "publisher")
	assertStatus(t, published, 201)
	submission := decodeResponse[Submission](t, published)
	if submission.SHA256 != fields["expectedDigest"] || submission.State != "published" {
		t.Fatalf("submission=%+v", submission)
	}
	fields["expectedDigest"] = "NOT-A-DIGEST"
	assertStatus(t, f.send(multipartArchiveRequest(t, "POST", "/submissions", fields, payload), "publisher"), 400)
}

// addPublisherAccount registers one extra publisher and its bearer session.
func addPublisherAccount(t *testing.T, f *httpFixture, account Account, tokenKey, token string) {
	t.Helper()
	f.repo.mu.Lock()
	f.repo.accounts[account.ID] = account
	f.repo.sessions[secretHash(token)] = testSession{accountID: account.ID, expires: time.Now().Add(time.Hour)}
	f.repo.mu.Unlock()
	f.tokens[tokenKey] = token
}

func TestPublisherDeleteOwnerPurgesPlugin(t *testing.T) {
	f := newHTTPFixture(t)
	f.publish(t, "acme.example", "1.0.0", "")
	assertStatus(t, f.request("PUT", "/plugins/acme.example/rating", "user", strings.NewReader(`{"stars":4,"body":"good"}`)), 200)
	assertStatus(t, f.request("POST", "/reports", "user", strings.NewReader(`{"pluginId":"acme.example","reason":"spam"}`)), 201)
	deleted := f.request("DELETE", "/publisher/plugins/acme.example", "publisher", nil)
	assertStatus(t, deleted, 200)
	if body := decodeResponse[map[string]bool](t, deleted); !body["deleted"] {
		t.Fatalf("body=%+v", body)
	}
	for _, path := range []string{"/plugins/acme.example", "/plugins/acme.example/versions", "/plugins/acme.example/ratings"} {
		assertStatus(t, f.request("GET", path, "", nil), 404)
	}
	plugins := decodeResponse[PublisherPluginPage](t, f.request("GET", "/publisher/plugins", "publisher", nil))
	if len(plugins.Items) != 0 {
		t.Fatalf("plugins=%+v", plugins)
	}
	submissions := decodeResponse[PublisherSubmissionPage](t, f.request("GET", "/publisher/submissions", "publisher", nil))
	if len(submissions.Items) != 0 {
		t.Fatalf("submissions=%+v", submissions)
	}
	f.repo.mu.Lock()
	if _, ok := f.repo.ratings["3/acme.example"]; ok {
		f.repo.mu.Unlock()
		t.Fatal("rating rows survived the purge")
	}
	f.repo.mu.Unlock()
	audits := decodeResponse[[]Audit](t, f.request("GET", "/admin/audit", "admin", nil))
	audited := false
	for _, audit := range audits {
		if audit.Action == "plugin.delete" && audit.Subject == "acme.example" && audit.Reason == "owner delete" && audit.ActorID == "1" {
			audited = true
		}
	}
	if !audited {
		t.Fatalf("missing plugin.delete audit: %+v", audits)
	}
	// A full purge releases the plugin/version reservation for a fresh upload.
	assertStatus(t, f.upload(t, "acme.example", "1.0.0", "publisher", archiveFixture(t, "acme.example", "1.0.0", ""), nil), 201)
}

func TestPublisherDeleteAuthorizationMissingAndAdminOverride(t *testing.T) {
	f := newHTTPFixture(t)
	f.publish(t, "acme.example", "1.0.0", "")
	addPublisherAccount(t, f, Account{ID: "9", Login: "other", Role: "publisher", PublisherID: "other"}, "other", strings.Repeat("o", 43))
	forbidden := f.request("DELETE", "/publisher/plugins/acme.example", "other", nil)
	assertStatus(t, forbidden, 403)
	if failure := decodeResponse[APIError](t, forbidden); failure.Code != "forbidden" || strings.Contains(forbidden.Body.String(), "acme") {
		t.Fatalf("non-owner response leaked detail: %+v", failure)
	}
	assertStatus(t, f.request("GET", "/plugins/acme.example", "", nil), 200)
	assertStatus(t, f.request("DELETE", "/publisher/plugins/acme.example", "", nil), 401)
	assertStatus(t, f.request("DELETE", "/publisher/plugins/acme.missing", "publisher", nil), 404)
	assertStatus(t, f.request("DELETE", "/publisher/plugins/ACME.example", "publisher", nil), 404)
	admin := f.request("DELETE", "/publisher/plugins/acme.example", "admin", nil)
	assertStatus(t, admin, 200)
	assertStatus(t, f.request("GET", "/plugins/acme.example", "", nil), 404)
}

func TestPublisherDeleteRequiresCSRFForCookieSessions(t *testing.T) {
	f := newHTTPFixture(t)
	f.publish(t, "acme.example", "1.0.0", "")
	cookie, token := browserSessionFor(t, f, "1")
	request := httptest.NewRequest("DELETE", "http://localhost:8090/api/v1/publisher/plugins/acme.example", nil)
	request.AddCookie(cookie)
	assertStatus(t, f.send(request, ""), 403)
	request = httptest.NewRequest("DELETE", "http://localhost:8090/api/v1/publisher/plugins/acme.example", nil)
	request.AddCookie(cookie)
	request.Header.Set("X-GoNavi-CSRF", token)
	assertStatus(t, f.send(request, ""), 200)
	assertStatus(t, f.request("GET", "/plugins/acme.example", "", nil), 404)
}
