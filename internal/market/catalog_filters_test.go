package market

import (
	"fmt"
	"net/url"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/marketfilter"
)

func TestHTTPCombinedFiltersRunBeforePaging(t *testing.T) {
	f := newHTTPFixture(t)
	account := f.repo.accounts["1"]
	account.Official = true
	f.repo.accounts["1"] = account
	f.repo.accounts["community"] = Account{ID: "community", PublisherID: "independent", Role: "publisher"}
	expected := map[string]bool{}
	for index := 0; index < 70; index++ {
		id := fmt.Sprintf("test.tool-%02d", index)
		owner := "1"
		if index%5 == 0 {
			owner = "community"
		}
		author := "GoNavi Team"
		if index >= 60 {
			author = "Other"
		}
		manifest := []byte(`{"contributes":{"skills":[{}]}}`)
		if index%2 == 1 {
			manifest = []byte(`{"contributes":{"panels":[{}],"commands":[{}]}}`)
		}
		if index%7 == 0 {
			manifest = []byte(`{}`)
		}
		platform := "windows/amd64"
		if index%2 == 1 {
			platform = "linux/arm64"
		}
		f.repo.releases[id] = testRelease{owner: owner, submission: Submission{ID: id, PluginID: id, Version: "1.0.0", State: "published", UpdatedAt: time.Unix(int64(index+1), 0)}, packageData: ValidatedPackage{ID: id, Name: fmt.Sprintf("Tool %d", index), Author: author, Version: "1.0.0", Platforms: []string{platform}, Manifest: manifest}}
		if index%5 != 0 && index < 60 && index%7 != 0 {
			expected[id] = true
		}
	}
	values := url.Values{"q": {"tool"}, "limit": {"24"}, "filtersVersion": {"1"}, "categories": {"skill", "ops"}, "official": {"official"}, "author": {"nAvI"}, "platforms": {"windows/amd64", "linux/arm64"}}
	first := decodeResponse[CatalogPage](t, f.request("GET", "/plugins?"+values.Encode(), "", nil))
	if len(first.Items) != 24 || first.NextCursor == "" || first.FilterVersion != 1 {
		t.Fatalf("first=%+v", first)
	}
	values.Set("cursor", first.NextCursor)
	second := decodeResponse[CatalogPage](t, f.request("GET", "/plugins?"+values.Encode(), "", nil))
	seen := map[string]bool{}
	for _, page := range []CatalogPage{first, second} {
		for _, item := range page.Items {
			if !expected[item.ID] || seen[item.ID] {
				t.Fatalf("wrong or duplicate match: %+v", item)
			}
			seen[item.ID] = true
		}
	}
	if len(seen) != len(expected) || second.NextCursor != "" {
		t.Fatalf("matches=%d expected=%d", len(seen), len(expected))
	}
}
func TestHTTPCatalogRejectsInvalidOrAmbiguousFilters(t *testing.T) {
	f := newHTTPFixture(t)
	for _, query := range []string{"categories=unknown", "official=true", "platforms=all&platforms=linux/amd64", "platform=linux/amd64&platforms=darwin/arm64", "category=skill&categories=ops", "filtersVersion=2"} {
		t.Run(query, func(t *testing.T) { assertStatus(t, f.request("GET", "/plugins?"+query, "", nil), 400) })
	}
}
func TestCatalogPredicatesDoNotResurrectOldCategory(t *testing.T) {
	repo := newMemoryRepo()
	repo.accounts["owner"] = Account{PublisherID: "publisher"}
	for index, manifest := range []string{`{"contributes":{"skills":[{}]}}`, `{"contributes":{"panels":[{}]}}`} {
		key := fmt.Sprint(index)
		repo.releases[key] = testRelease{owner: "owner", submission: Submission{PluginID: "test.changed", State: "published", UpdatedAt: time.Unix(int64(index+1), 0)}, packageData: ValidatedPackage{ID: "test.changed", Name: "Changed", Version: "1.0.0", Manifest: []byte(manifest)}}
	}
	page, err := repo.Catalog(t.Context(), CatalogQuery{Limit: 24, Filters: marketfilter.Filters{Categories: []string{"skill"}}})
	if err != nil || len(page.Items) != 0 {
		t.Fatalf("old category revived: %+v %v", page, err)
	}
}
func TestCatalogSQLBindsAllConditionsBeforeLimit(t *testing.T) {
	author := "author' OR true--"
	statement, args := catalogStatement(CatalogQuery{Limit: 24, Filters: marketfilter.Filters{Categories: []string{"skill"}, Platforms: []string{"linux/amd64"}, Official: "community", Author: author}}, "v.updated_at DESC")
	if strings.Contains(statement, author) || len(args) != 10 || args[9] != author {
		t.Fatalf("unsafe arguments: %+v", args)
	}
	for _, predicate := range []string{"platforms && $8::text[]", "market_plugin_category(v.manifest)=ANY($7::text[])", "$9='community'", "lower($10)"} {
		if strings.Index(statement, predicate) < 0 || strings.Index(statement, predicate) > strings.Index(statement, "LIMIT $2") {
			t.Fatalf("predicate after paging: %s", predicate)
		}
	}
}
