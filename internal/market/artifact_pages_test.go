package market

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func artifactPageManifest(t *testing.T, permissions []string, contributes any) artifactManifest {
	t.Helper()
	raw := artifactTestChange(t, func(fields map[string]any) {
		fields["permissions"] = permissions
		fields["contributes"] = contributes
	})
	manifest, err := decodeArtifactManifest([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	return manifest
}

func artifactTextPageMap(id, title string) map[string]any {
	return map[string]any{"id": id, "title": title, "body": map[string]any{"type": "text", "text": "hello"}}
}

func artifactNavigationMap(id, page string) map[string]any {
	return map[string]any{"id": id, "title": "Nav", "page": page, "location": "tools"}
}

func TestValidatePackageAcceptsPagesAndNavigation(t *testing.T) {
	manifest := artifactTestChange(t, func(fields map[string]any) {
		fields["permissions"] = []string{"ui.pages", "ui.html-panel"}
		fields["contributes"] = map[string]any{
			"pages": []any{
				artifactTextPageMap("overview", "Overview"),
				map[string]any{"id": "dashboard", "title": "Dashboard", "html": map[string]any{"source": "<h1>Dash</h1>"}},
			},
			"navigation": []any{
				map[string]any{"id": "overview-tools", "title": "Overview", "page": "overview", "location": "tools", "order": -1000},
				map[string]any{"id": "dashboard-tools", "title": "Dashboard", "page": "dashboard", "location": "tools", "order": 1000},
			},
		}
	})
	filename := artifactTestWrite(t, ".zip", artifactTestZIP(t, artifactTestEntries(manifest)))
	if _, err := ValidatePackage(context.Background(), filename); err != nil {
		t.Fatalf("declared pages and navigation were rejected: %v", err)
	}
}

func TestValidatePackageRejectsPagesWithoutPermission(t *testing.T) {
	manifest := artifactTestChange(t, func(fields map[string]any) {
		fields["contributes"] = map[string]any{"pages": []any{artifactTextPageMap("main", "Main")}}
	})
	filename := artifactTestWrite(t, ".zip", artifactTestZIP(t, artifactTestEntries(manifest)))
	if _, err := ValidatePackage(context.Background(), filename); err == nil {
		t.Fatal("pages without ui.pages were accepted")
	}
}

func TestArtifactPagesRequireUIPagesPermission(t *testing.T) {
	manifest := artifactPageManifest(t, []string{}, map[string]any{
		"pages": []any{artifactTextPageMap("main", "Main")},
	})
	if validateArtifactContributions(manifest) == nil {
		t.Fatal("pages without ui.pages were accepted")
	}
	manifest = artifactPageManifest(t, []string{}, map[string]any{
		"navigation": []any{artifactNavigationMap("nav", "missing")},
	})
	if validateArtifactContributions(manifest) == nil {
		t.Fatal("navigation without ui.pages were accepted")
	}
}

func TestArtifactPageDeclarationRejectsUnsafeDeclarations(t *testing.T) {
	bothBodies := map[string]any{
		"id": "both", "title": "Both",
		"body": map[string]any{"type": "text"},
		"html": map[string]any{"source": "<p>x</p>"},
	}
	cases := []struct {
		name        string
		permissions []string
		contributes map[string]any
	}{
		{"duplicate id", []string{"ui.pages"}, map[string]any{"pages": []any{artifactTextPageMap("dup", "A"), artifactTextPageMap("dup", "B")}}},
		{"both bodies", []string{"ui.pages", "ui.html-panel"}, map[string]any{"pages": []any{bothBodies}}},
		{"no body", []string{"ui.pages"}, map[string]any{"pages": []any{map[string]any{"id": "empty", "title": "Empty"}}}},
		{"invalid id", []string{"ui.pages"}, map[string]any{"pages": []any{map[string]any{"id": "../escape", "title": "Escape", "body": map[string]any{"type": "text"}}}}},
		{"blank title", []string{"ui.pages"}, map[string]any{"pages": []any{map[string]any{"id": "blank", "title": " ", "body": map[string]any{"type": "text"}}}}},
		{"undeclared command", []string{"ui.pages"}, map[string]any{"pages": []any{map[string]any{"id": "button", "title": "Button", "body": map[string]any{"type": "button", "command": "run"}}}}},
		{"html without permission", []string{"ui.pages"}, map[string]any{"pages": []any{map[string]any{"id": "html", "title": "HTML", "html": map[string]any{"source": "<p>x</p>"}}}}},
		{"empty html", []string{"ui.pages", "ui.html-panel"}, map[string]any{"pages": []any{map[string]any{"id": "html", "title": "HTML", "html": map[string]any{"source": " "}}}}},
		{"nul html", []string{"ui.pages", "ui.html-panel"}, map[string]any{"pages": []any{map[string]any{"id": "html", "title": "HTML", "html": map[string]any{"source": "<p>a\x00b</p>"}}}}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			manifest := artifactPageManifest(t, test.permissions, test.contributes)
			if validateArtifactContributions(manifest) == nil {
				t.Fatalf("unsafe page declaration %q was accepted", test.name)
			}
		})
	}
}

// The bounded html rule is checked on the decoded declaration because the root
// manifest byte cap already rejects a maximum-size source during decoding.
func TestArtifactPageHTMLBounds(t *testing.T) {
	page := func(source string) artifactManifest {
		return artifactManifest{
			Permissions: []string{"ui.pages", "ui.html-panel"},
			Contributes: artifactContributions{Pages: []artifactPage{{
				ID: "html", Title: "HTML", HTML: &artifactHTMLPanel{Source: source},
			}}},
		}
	}
	if err := validateArtifactContributions(page(strings.Repeat("a", 256<<10))); err != nil {
		t.Fatalf("bounded html page was rejected: %v", err)
	}
	if validateArtifactContributions(page(strings.Repeat("a", (256<<10)+1))) == nil {
		t.Fatal("html page over the byte limit was accepted")
	}
}
func TestArtifactNavigationDeclarationRejectsUnsafeEntries(t *testing.T) {
	cases := []struct {
		name string
		item map[string]any
	}{
		{"invalid id", map[string]any{"id": "../nav", "title": "Nav", "page": "main", "location": "tools"}},
		{"blank title", map[string]any{"id": "nav", "title": " ", "page": "main", "location": "tools"}},
		{"undeclared page", artifactNavigationMap("nav", "missing")},
		{"empty location", map[string]any{"id": "nav", "title": "Nav", "page": "main"}},
		{"unknown location", map[string]any{"id": "nav", "title": "Nav", "page": "main", "location": "menu"}},
		{"order high", map[string]any{"id": "nav", "title": "Nav", "page": "main", "location": "tools", "order": 1001}},
		{"order low", map[string]any{"id": "nav", "title": "Nav", "page": "main", "location": "tools", "order": -1001}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			manifest := artifactPageManifest(t, []string{"ui.pages"}, map[string]any{
				"pages":      []any{artifactTextPageMap("main", "Main")},
				"navigation": []any{test.item},
			})
			if validateArtifactContributions(manifest) == nil {
				t.Fatalf("unsafe navigation %q was accepted", test.name)
			}
		})
	}
	manifest := artifactPageManifest(t, []string{"ui.pages"}, map[string]any{
		"pages":      []any{artifactTextPageMap("main", "Main")},
		"navigation": []any{artifactNavigationMap("nav", "main")},
	})
	if err := validateArtifactContributions(manifest); err != nil {
		t.Fatalf("valid navigation was rejected: %v", err)
	}
}

func TestArtifactPageAndNavigationCountBounds(t *testing.T) {
	pages := make([]any, 0, artifactMaxPages+1)
	for i := 0; i < artifactMaxPages; i++ {
		pages = append(pages, artifactTextPageMap(fmt.Sprintf("page%d", i), "Page"))
	}
	manifest := artifactPageManifest(t, []string{"ui.pages"}, map[string]any{"pages": pages})
	if err := validateArtifactContributions(manifest); err != nil {
		t.Fatalf("%d pages were rejected: %v", artifactMaxPages, err)
	}
	manifest = artifactPageManifest(t, []string{"ui.pages"}, map[string]any{"pages": append(pages, artifactTextPageMap("extra", "Extra"))})
	if validateArtifactContributions(manifest) == nil {
		t.Fatalf("%d pages were accepted", artifactMaxPages+1)
	}
	navigation := make([]any, 0, artifactMaxNavigation+1)
	for i := 0; i < artifactMaxNavigation; i++ {
		navigation = append(navigation, artifactNavigationMap(fmt.Sprintf("nav%d", i), "main"))
	}
	manifest = artifactPageManifest(t, []string{"ui.pages"}, map[string]any{
		"pages":      []any{artifactTextPageMap("main", "Main")},
		"navigation": navigation,
	})
	if err := validateArtifactContributions(manifest); err != nil {
		t.Fatalf("%d navigation entries were rejected: %v", artifactMaxNavigation, err)
	}
	manifest = artifactPageManifest(t, []string{"ui.pages"}, map[string]any{
		"pages":      []any{artifactTextPageMap("main", "Main")},
		"navigation": append(navigation, artifactNavigationMap("extra", "main")),
	})
	if validateArtifactContributions(manifest) == nil {
		t.Fatalf("%d navigation entries were accepted", artifactMaxNavigation+1)
	}
}

func TestArtifactPageJSONShape(t *testing.T) {
	cases := map[string]string{
		"unknown page field":       `{"pages":[{"id":"p","title":"P","body":{"type":"text"},"icon":"x"}]}`,
		"unknown navigation field": `{"navigation":[{"id":"n","title":"N","page":"p","location":"tools","icon":"x"}]}`,
		"unknown contribution":     `{"pages":[],"menu":[]}`,
		"null page body":           `{"pages":[{"id":"p","title":"P","body":null,"html":{"source":"<p>x</p>"}}]}`,
		"pages not an array":       `{"pages":{}}`,
		"null navigation":          `{"navigation":null}`,
		"order not an integer":     `{"navigation":[{"id":"n","title":"N","page":"p","location":"tools","order":"first"}]}`,
		"html source not text":     `{"pages":[{"id":"p","title":"P","html":{"source":123}}]}`,
	}
	for name, contributes := range cases {
		t.Run(name, func(t *testing.T) {
			raw := artifactTestChange(t, func(fields map[string]any) {
				fields["permissions"] = []string{"ui.pages", "ui.html-panel"}
				fields["contributes"] = json.RawMessage(contributes)
			})
			if _, err := decodeArtifactManifest([]byte(raw)); err == nil {
				t.Fatalf("invalid page json %q was accepted", name)
			}
		})
	}
}
