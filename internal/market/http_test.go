package market

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type httpFixture struct {
	repo    *memoryRepo
	server  *Server
	handler http.Handler
	tokens  map[string]string
}

func newHTTPFixture(t *testing.T) *httpFixture {
	t.Helper()
	repo := newMemoryRepo()
	tokens := map[string]string{"publisher": strings.Repeat("p", 43), "admin": strings.Repeat("a", 43), "user": strings.Repeat("u", 43)}
	for _, a := range []Account{{ID: "1", Login: "author", Role: "publisher", PublisherID: "acme"}, {ID: "2", Login: "reviewer", Role: "admin"}, {ID: "3", Login: "reader", Role: "user"}} {
		repo.accounts[a.ID] = a
		repo.sessions[secretHash(tokens[a.Role])] = testSession{accountID: a.ID, expires: time.Now().Add(time.Hour)}
	}
	store, err := NewFileStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(ServerOptions{Repository: repo, Artifacts: store, PublicURL: "http://localhost:8090"})
	if err != nil {
		t.Fatal(err)
	}
	return &httpFixture{repo: repo, server: server, handler: server.Handler(), tokens: tokens}
}

func (f *httpFixture) request(method, path, role string, body io.Reader) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "http://localhost:8090/api/v1"+path, body)
	if role != "" {
		request.Header.Set("Authorization", "Bearer "+f.tokens[role])
	}
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, request)
	return response
}

func assertStatus(t *testing.T, r *httptest.ResponseRecorder, status int) {
	t.Helper()
	if r.Code != status {
		t.Fatalf("status=%d want=%d body=%s", r.Code, status, r.Body.String())
	}
}

func decodeResponse[T any](t *testing.T, r *httptest.ResponseRecorder) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(r.Body.Bytes(), &value); err != nil {
		t.Fatalf("decode response: %v; %s", err, r.Body.String())
	}
	return value
}

func archiveFixture(t *testing.T, id, version, minHost string) []byte {
	t.Helper()
	manifest := map[string]any{"schemaVersion": 1, "apiVersion": 1, "id": id, "name": "Example", "version": version, "permissions": []string{},
		"author": "Untrusted display label", "backend": map[string]any{"default": map[string]any{"executable": "bin/plugin", "runtime": "native"}}}
	if minHost != "" {
		manifest["minHostVersion"] = minHost
	}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	writer := zip.NewWriter(&body)
	for _, file := range []struct {
		name string
		data []byte
	}{{name: "gonavi.plugin.json", data: encoded}, {name: "bin/plugin", data: []byte("not executed")}} {
		entry, createErr := writer.Create(file.name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, err = entry.Write(file.data); err != nil {
			t.Fatal(err)
		}
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body.Bytes()
}

func (f *httpFixture) upload(t *testing.T, id, version, role string, archive []byte, extra map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := map[string]string{"pluginId": id, "version": version}
	for key, value := range extra {
		fields[key] = value
	}
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
	req := httptest.NewRequest("POST", "http://localhost:8090/api/v1/submissions", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+f.tokens[role])
	result := httptest.NewRecorder()
	f.handler.ServeHTTP(result, req)
	return result
}

func (f *httpFixture) publish(t *testing.T, id, version, minHost string) Submission {
	t.Helper()
	response := f.upload(t, id, version, "publisher", archiveFixture(t, id, version, minHost), nil)
	assertStatus(t, response, 201)
	submission := decodeResponse[Submission](t, response)
	if submission.State != "pending_review" {
		t.Fatalf("state=%s", submission.State)
	}
	response = f.request("POST", "/admin/submissions/"+submission.ID+"/approve", "admin", strings.NewReader("{}"))
	assertStatus(t, response, 200)
	return decodeResponse[Submission](t, response)
}

func TestHTTPReviewedPublicationAndImmutableDownload(t *testing.T) {
	f := newHTTPFixture(t)
	payload := archiveFixture(t, "acme.example", "1.0.0", "")
	response := f.upload(t, "acme.example", "1.0.0", "publisher", payload, nil)
	assertStatus(t, response, 201)
	submission := decodeResponse[Submission](t, response)
	page := decodeResponse[CatalogPage](t, f.request("GET", "/plugins", "", nil))
	if len(page.Items) != 0 {
		t.Fatal("pending version leaked")
	}
	assertStatus(t, f.request("GET", "/artifacts/"+submission.SHA256, "", nil), 404)
	assertStatus(t, f.request("POST", "/admin/submissions/"+submission.ID+"/approve", "publisher", strings.NewReader("{}")), 403)
	assertStatus(t, f.request("POST", "/admin/submissions/"+submission.ID+"/approve", "admin", strings.NewReader("{}")), 200)
	detail := decodeResponse[MarketPlugin](t, f.request("GET", "/plugins/acme.example", "", nil))
	hash := sha256.Sum256(payload)
	if detail.Official || detail.Artifact.SHA256 != hex.EncodeToString(hash[:]) || len(detail.Manifest) == 0 {
		t.Fatalf("invalid public detail: %+v", detail)
	}
	if detail.Artifact.URL != "http://localhost:8090/api/v1/artifacts/"+submission.SHA256 {
		t.Fatal("artifact changed origin")
	}
	download := f.request("GET", "/artifacts/"+submission.SHA256, "", nil)
	assertStatus(t, download, 200)
	if !bytes.Equal(download.Body.Bytes(), payload) {
		t.Fatal("artifact changed")
	}
	assertStatus(t, f.upload(t, "acme.example", "1.0.0", "publisher", payload, nil), 409)
	assertStatus(t, f.request("POST", "/admin/submissions/"+submission.ID+"/yank", "admin", strings.NewReader(`{"reason":"security issue"}`)), 200)
	for _, path := range []string{"/plugins/acme.example", "/plugins/acme.example/versions", "/artifacts/" + submission.SHA256} {
		assertStatus(t, f.request("GET", path, "", nil), 404)
	}
	audit := decodeResponse[[]Audit](t, f.request("GET", "/admin/audit", "admin", nil))
	if len(audit) < 6 {
		t.Fatal("missing review history")
	}
}

func TestHTTPRatingsUpsertDeleteHideAndAuthorGuard(t *testing.T) {
	f := newHTTPFixture(t)
	f.publish(t, "acme.example", "1.0.0", "")
	ratingPath := "/plugins/acme.example/rating"
	assertStatus(t, f.request("PUT", ratingPath, "", strings.NewReader(`{"stars":5}`)), 401)
	assertStatus(t, f.request("PUT", ratingPath, "publisher", strings.NewReader(`{"stars":5}`)), 403)
	for _, stars := range []string{"5", "2"} {
		assertStatus(t, f.request("PUT", ratingPath, "user", strings.NewReader(`{"stars":`+stars+`,"body":"review","version":"1.0.0"}`)), 200)
	}
	detail := decodeResponse[MarketPlugin](t, f.request("GET", "/plugins/acme.example", "", nil))
	if detail.RatingCount != 1 || detail.RatingAverage != 2 {
		t.Fatalf("aggregate=%+v", detail)
	}
	assertStatus(t, f.request("POST", "/admin/plugins/acme.example/ratings/3/hide", "admin", strings.NewReader(`{"reason":"abuse"}`)), 200)
	assertStatus(t, f.request("PUT", ratingPath, "user", strings.NewReader(`{"stars":5}`)), 200)
	detail = decodeResponse[MarketPlugin](t, f.request("GET", "/plugins/acme.example", "", nil))
	if detail.RatingCount != 0 {
		t.Fatal("hidden rating counted")
	}
	assertStatus(t, f.request("DELETE", ratingPath, "user", nil), 200)
	ratings := decodeResponse[[]Rating](t, f.request("GET", "/plugins/acme.example/ratings", "", nil))
	if len(ratings) != 0 {
		t.Fatal("deleted rating leaked")
	}
	assertStatus(t, f.request("PUT", ratingPath, "user", strings.NewReader(`{"stars":5,"body":"recreated"}`)), 200)
	detail = decodeResponse[MarketPlugin](t, f.request("GET", "/plugins/acme.example", "", nil))
	if detail.RatingCount != 0 {
		t.Fatal("delete/recreate bypassed moderation")
	}
}

func TestHTTPConcurrentRatingsRemainUnique(t *testing.T) {
	f := newHTTPFixture(t)
	f.publish(t, "acme.example", "1.0.0", "")
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := f.request("PUT", "/plugins/acme.example/rating", "user", strings.NewReader(`{"stars":4}`))
			if r.Code != 200 {
				t.Errorf("concurrent status=%d", r.Code)
			}
		}()
	}
	wg.Wait()
	item, err := f.repo.Plugin(context.Background(), "acme.example")
	if err != nil || item.RatingCount != 1 || item.RatingAverage != 4 {
		t.Fatalf("aggregate=%+v err=%v", item, err)
	}
}
