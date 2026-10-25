package market

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"testing"

	"GoNavi-Wails/internal/marketfilter"
)

func TestPostgresCombinedFiltersBeforePagination(t *testing.T) {
	p := postgresFixture(t)
	ctx := t.Context()
	publisher := pgAccount(t, p, "filters-publisher", "publisher", "filters-publisher", true)
	admin := pgAccount(t, p, "filters-admin", "admin", "", false)
	for index := 0; index < 25; index++ {
		s := pgSubmit(t, p, publisher, fmt.Sprintf("filter.tool-%02d", index), "1.0.0")
		if _, err := p.Review(ctx, admin, s.ID, "approve", ""); err != nil {
			t.Fatal(err)
		}
	}
	example, err := p.Plugin(ctx, "filter.tool-00")
	if err != nil {
		t.Fatal(err)
	}
	platform := "windows/amd64"
	if len(example.Platforms) > 0 && example.Platforms[0] != "any" {
		platform = example.Platforms[0]
	}
	query := CatalogQuery{Limit: 24, Filters: marketfilter.Filters{Categories: []string{example.Category}, Platforms: []string{platform}, Official: "official", Author: "FILTERS-PUBLISHER"}}
	first, err := p.Catalog(ctx, query)
	if err != nil || len(first.Items) != 24 || first.NextCursor == "" {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	cursor, err := base64.RawURLEncoding.DecodeString(first.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	query.Offset, err = strconv.Atoi(string(cursor))
	if err != nil {
		t.Fatal(err)
	}
	second, err := p.Catalog(ctx, query)
	if err != nil || len(second.Items) != 1 || second.NextCursor != "" {
		t.Fatalf("second=%+v err=%v", second, err)
	}
	seen := map[string]bool{}
	for _, page := range []CatalogPage{first, second} {
		for _, item := range page.Items {
			if seen[item.ID] {
				t.Fatal("duplicate cross-page result")
			}
			seen[item.ID] = true
		}
	}
	query.Offset = 0
	query.Filters.Official = "community"
	none, err := p.Catalog(ctx, query)
	if err != nil || len(none.Items) != 0 {
		t.Fatalf("AND identity not applied: %+v %v", none, err)
	}
	query.Filters.Official = "official"
	query.Filters.Author = "missing' OR true --"
	none, err = p.Catalog(ctx, query)
	if err != nil || len(none.Items) != 0 {
		t.Fatalf("author parameter not literal: %+v %v", none, err)
	}
}
