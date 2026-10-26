package market

import (
	"encoding/json"
	"net/url"
	"testing"
)

func TestCategoryFromManifest(t *testing.T) {
	for _, test := range []struct{ name, raw, want string }{
		{"datasource", `{"contributes":{"dataSources":[{}]}}`, "datasource"},
		{"provider", `{"contributes":{"aiProviders":[{}]}}`, "ai-provider"},
		{"exporter", `{"contributes":{"exporters":[{}]}}`, "exporter"},
		{"operations", `{"contributes":{"commands":[{}],"panels":[{}],"skills":[{}]}}`, "ops"},
		{"panel", `{"contributes":{"panels":[{}]}}`, "panel"},
		{"skill", `{"contributes":{"skills":[{}]}}`, "skill"},
		{"command", `{"contributes":{"commands":[{}]}}`, "command"},
		{"window", `{"window":{"entry":"ui.html"}}`, "panel"},
		{"unknown", `{"contributes":{}}`, "other"},
		{"invalid", "{", "other"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := categoryFromManifest(json.RawMessage(test.raw)); got != test.want {
				t.Fatalf("category=%q want %q", got, test.want)
			}
		})
	}
}
func TestCatalogCategoryValidation(t *testing.T) {
	for _, value := range []string{"ops", "运维", "skill", "技能", "全部", ""} {
		if _, err := parseCatalogQuery(url.Values{"category": {value}}); err != nil {
			t.Fatalf("category %q rejected: %v", value, err)
		}
	}
	if _, err := parseCatalogQuery(url.Values{"category": {"unknown"}}); err == nil {
		t.Fatal("unknown category accepted")
	}
}
