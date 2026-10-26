package market

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCatalogOfficialFirstAndCompatibleVersion(t *testing.T) {
	f := newHTTPFixture(t)
	account := f.repo.accounts["1"]
	account.Official = true
	f.repo.accounts["1"] = account
	f.publish(t, "acme.example", "1.0.0", "1.0.0")
	f.publish(t, "acme.example", "2.0.0", "5.0.0")
	f.repo.accounts["4"] = Account{ID: "4", Role: "publisher", PublisherID: "community"}
	f.tokens["community"] = strings.Repeat("c", 43)
	f.repo.sessions[secretHash(f.tokens["community"])] = testSession{accountID: "4", expires: time.Now().Add(time.Hour)}
	response := f.upload(t, "community.example", "1.0.0", "community", archiveFixture(t, "community.example", "1.0.0", ""), nil)
	assertStatus(t, response, 201)
	assertStatus(t, f.request("PUT", "/plugins/community.example/rating", "user", strings.NewReader(`{"stars":5}`)), 200)
	for _, sort := range []string{"rating", "downloads", "updated"} {
		page := decodeResponse[CatalogPage](t, f.request("GET", "/plugins?sort="+sort+"&hostVersion=1.0.0&limit=1", "", nil))
		if len(page.Items) != 1 || page.Items[0].ID != "acme.example" || page.Items[0].Version != "1.0.0" || page.NextCursor == "" {
			t.Fatalf("page=%+v", page)
		}
	}
	page := decodeResponse[CatalogPage](t, f.request("GET", "/plugins?q=community&sort=rating", "", nil))
	if len(page.Items) != 1 || page.Items[0].Official || page.Items[0].RatingAverage != 5 {
		t.Fatalf("real rating=%+v", page)
	}
}

func TestHTTPYankRestoresPriorRelease(t *testing.T) {
	f := newHTTPFixture(t)
	f.publish(t, "acme.example", "1.0.0", "")
	submission := f.publish(t, "acme.example", "2.0.0", "")
	assertStatus(t, f.request("POST", "/admin/submissions/"+submission.ID+"/yank", "admin", strings.NewReader(`{"reason":"regression report"}`)), 200)
	detail := decodeResponse[MarketPlugin](t, f.request("GET", "/plugins/acme.example", "", nil))
	if detail.Version != "1.0.0" {
		t.Fatal("yanked version still shadows the prior release")
	}
	assertStatus(t, f.request("GET", "/plugins/acme.example/versions/2.0.0/artifact", "", nil), 404)
	assertStatus(t, f.request("POST", "/admin/submissions/"+submission.ID+"/approve", "admin", strings.NewReader("{}")), 409)
}

func TestHTTPStructuredErrorsAndOfficialSpoof(t *testing.T) {
	f := newHTTPFixture(t)
	for _, test := range []struct {
		name, path string
		status     int
	}{
		{name: "invalid limit", path: "/plugins?limit=101", status: 400},
		{name: "invalid cursor", path: "/plugins?cursor=bad", status: 400},
		{name: "invalid host", path: "/plugins?hostVersion=banana", status: 400},
		{name: "unknown route", path: "/not-found", status: 404},
		{name: "private admin", path: "/admin/audit", status: 401},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := f.request("GET", test.path, "", nil)
			assertStatus(t, response, test.status)
			e := decodeResponse[APIError](t, response)
			if e.Code == "" || e.Message == "" {
				t.Fatal("unstructured error")
			}
		})
	}
	payload := archiveFixture(t, "acme.example", "1.0.0", "")
	assertStatus(t, f.upload(t, "acme.example", "1.0.0", "publisher", payload, map[string]string{"official": "true"}), 400)
	assertStatus(t, f.upload(t, "acme.example", "1.0.0", "user", payload, nil), 403)
	assertStatus(t, f.upload(t, "other.example", "1.0.0", "publisher", payload, nil), 403)
	assertStatus(t, f.upload(t, "acme.example", "1.0.1", "publisher", payload, nil), 400)
	response := f.request("GET", "/submissions", "publisher", nil)
	submissions := decodeResponse[[]Submission](t, response)
	if len(submissions) != 1 || submissions[0].State != "rejected" {
		t.Fatal("validation failure not retained")
	}
}

func TestHTTPBoundedJSONAndRateLimit(t *testing.T) {
	f := newHTTPFixture(t)
	f.publish(t, "acme.example", "1.0.0", "")
	for _, body := range []string{
		`{"stars":0}`, `{"stars":6}`, `{"stars":4,"official":true}`, `{"stars":4} {}`,
		`{"stars":4,"body":"` + strings.Repeat("x", 70<<10) + `"}`,
	} {
		assertStatus(t, f.request("PUT", "/plugins/acme.example/rating", "user", strings.NewReader(body)), 400)
	}
	request := httptest.NewRequest("POST", "http://localhost:8090/api/v1/auth/logout", nil)
	request.RemoteAddr = "127.0.0.2:4200"
	for i := 0; i < 120; i++ {
		f.server.allowWrite(request)
	}
	if f.server.allowWrite(request) {
		t.Fatal("rate limit not enforced")
	}
}
