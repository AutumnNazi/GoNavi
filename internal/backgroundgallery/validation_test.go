package backgroundgallery

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestRefreshRejectsInvalidCatalogAndRetainsCache(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Catalog)
	}{
		{"schema", func(c *Catalog) { c.SchemaVersion = 2 }},
		{"duplicate", func(c *Catalog) { c.Entries = append(c.Entries, c.Entries[0]) }},
		{"too many entries", func(c *Catalog) {
			for range 64 {
				c.Entries = append(c.Entries, c.Entries[0])
			}
		}},
		{"invalid id", func(c *Catalog) { c.Entries[0].ID = "../escape" }},
		{"invalid version", func(c *Catalog) { c.Entries[0].Version = "../1" }},
		{"missing rights", func(c *Catalog) { c.Entries[0].License.Text = "" }},
		{"unapproved", func(c *Catalog) { c.Entries[0].RightsStatus = "pending" }},
		{"absolute url", func(c *Catalog) { c.Entries[0].Image.Path = "https://evil.test/image.png" }},
		{"encoded traversal", func(c *Catalog) { c.Entries[0].Image.Path = "assets/%2e%2e/secret.png" }},
		{"backslash", func(c *Catalog) { c.Entries[0].Image.Path = "assets\\secret.png" }},
		{"query", func(c *Catalog) { c.Entries[0].Image.Path += "?x=1" }},
		{"fragment", func(c *Catalog) { c.Entries[0].Image.Path += "#x" }},
		{"hash", func(c *Catalog) { c.Entries[0].Image.SHA256 = strings.Repeat("A", 64) }},
		{"mime", func(c *Catalog) { c.Entries[0].Image.MIMEType = "image/svg+xml" }},
		{"image bytes", func(c *Catalog) { c.Entries[0].Image.SizeBytes = 16<<20 + 1 }},
		{"thumbnail bytes", func(c *Catalog) { c.Entries[0].Thumbnail.SizeBytes = 256<<10 + 1 }},
		{"pixels", func(c *Catalog) { c.Entries[0].Image.Width = 6000; c.Entries[0].Image.Height = 6000 }},
		{"zero dimensions", func(c *Catalog) { c.Entries[0].Image.Width = 0 }},
		{"oversized name", func(c *Catalog) { c.Entries[0].Names["en"] = strings.Repeat("a", 257) }},
		{"source credentials", func(c *Catalog) { c.Entries[0].SourceURL = "https://user:pass@example.com/source" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var invalid atomic.Bool
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				catalog := Catalog{SchemaVersion: 1, Version: "1", Entries: []Entry{fixtureEntry()}}
				if invalid.Load() {
					test.mutate(&catalog)
				}
				w.Header().Set("Content-Type", "application/json")
				if err := json.NewEncoder(w).Encode(catalog); err != nil {
					t.Error(err)
				}
			}))
			defer server.Close()
			s, err := NewService(Options{Root: t.TempDir(), BaseURL: server.URL + "/", Client: server.Client()})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.Refresh(context.Background()); err != nil {
				t.Fatal(err)
			}
			invalid.Store(true)
			state, err := s.Refresh(context.Background())
			if err != nil || !state.Stale || state.WarningCode != "invalid_catalog" || state.Catalog.Entries[0].ID != "whale-maid-a" {
				t.Fatalf("invalid replacement accepted: %+v %v", state, err)
			}
		})
	}
}

func TestRefreshRejectsResponseBoundsAndRedirects(t *testing.T) {
	for _, test := range []struct {
		name, contentType, body string
		status                  int
		code                    string
	}{
		{"oversize", "application/json", strings.Repeat(" ", 2<<20+1), 200, "invalid_catalog"},
		{"wrong mime", "text/html", "{}", 200, "invalid_catalog"},
		{"trailing json", "application/json", "{} {}", 200, "invalid_catalog"},
		{"unknown field", "application/json", `{"schemaVersion":1,"version":"1","entries":[],"secret":true}`, 200, "invalid_catalog"},
		{"redirect", "application/json", "", 302, "download_failed"},
		{"not found", "application/json", "", 404, "download_failed"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var hits atomic.Int32
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hits.Add(1)
				w.Header().Set("Content-Type", test.contentType)
				w.Header().Set("Location", "/elsewhere")
				w.WriteHeader(test.status)
				if _, err := w.Write([]byte(test.body)); err != nil {
					t.Error(err)
				}
			}))
			defer server.Close()
			s, err := NewService(Options{Root: t.TempDir(), BaseURL: server.URL + "/", Client: server.Client()})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.Refresh(context.Background()); ErrorCode(err) != test.code {
				t.Fatalf("wrong failure: %v", err)
			}
			if hits.Load() != 1 {
				t.Fatalf("followed redirect: %d", hits.Load())
			}
		})
	}
}

func TestConstructorRejectsUnsafeBaseURLs(t *testing.T) {
	for _, base := range []string{"http://example.com/", "https://user:pass@example.com/", "https://example.com/?x=1", "https://example.com/#x", "https://example.com/%2e%2e/", "https://example.com/path", "https://example.com/../"} {
		t.Run(base, func(t *testing.T) {
			if _, err := NewService(Options{Root: t.TempDir(), BaseURL: base}); ErrorCode(err) != "invalid_catalog" {
				t.Fatalf("unsafe base accepted: %v", err)
			}
		})
	}
}
