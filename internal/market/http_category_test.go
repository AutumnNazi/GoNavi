package market

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"
)

func catalogCategoryFixture(t *testing.T) *httpFixture {
	t.Helper()
	f := newHTTPFixture(t)
	for index, entry := range []struct{ id, manifest string }{
		{"acme.ops1", `{"contributes":{"panels":[{}],"commands":[{}]}}`},
		{"acme.ops2", `{"contributes":{"panels":[{}],"commands":[{}]}}`},
		{"acme.skill", `{"contributes":{"skills":[{}]}}`},
	} {
		f.repo.releases[entry.id] = testRelease{owner: "1", submission: Submission{ID: entry.id, PluginID: entry.id, Version: "1.0.0", State: "published", UpdatedAt: time.Now().Add(-time.Duration(index) * time.Hour)}, packageData: ValidatedPackage{ID: entry.id, Name: entry.id, Version: "1.0.0", Manifest: json.RawMessage(entry.manifest), Platforms: []string{"any"}, SHA256: strings.Repeat("a", 64), SizeBytes: 1}}
	}
	return f
}
func TestCatalogFiltersCategoryBeforePaging(t *testing.T) {
	f := catalogCategoryFixture(t)
	response := f.request("GET", "/plugins?limit=1&category="+url.QueryEscape("技能"), "", nil)
	assertStatus(t, response, 200)
	page := decodeResponse[CatalogPage](t, response)
	if len(page.Items) != 1 || page.Items[0].ID != "acme.skill" || page.Items[0].Category != "skill" || page.NextCursor != "" {
		t.Fatalf("category filter must precede paging: %+v", page)
	}
}
func TestCatalogCategoryDescribesOperations(t *testing.T) {
	f := catalogCategoryFixture(t)
	page := decodeResponse[CatalogPage](t, f.request("GET", "/plugins?category="+url.QueryEscape("运维"), "", nil))
	if len(page.Items) != 2 || page.Items[0].Category != "ops" {
		t.Fatalf("operations missing from catalog: %+v", page)
	}
}
