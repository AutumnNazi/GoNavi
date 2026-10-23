package plugin

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestShippedContributionNamesRoundTrip(t *testing.T) {
	manifest := Manifest{
		SchemaVersion: 1, APIVersion: 1, ID: "example.bundle", Name: "Bundle", Version: "1.0.0",
		Permissions: []string{"data.sources", "ai.skills", "ai.providers", "data.export"},
		Contributes: &Contributions{
			DataSources: []DataSource{{ID: "db", Name: "DB", Dialect: "sqlite", Command: "db", ReadOnly: true}},
			Skills:      []Skill{{ID: "guide", Name: "Guide", Description: "Read", Entry: "SKILL.md", Resources: []string{"NOTES.md"}}},
			AIProviders: []AIProvider{{ID: "chat", Name: "Chat", Command: "chat", Models: []AIModel{{ID: "m", Name: "M", ContextWindow: 8, MaxOutputTokens: 2}}, SupportsTools: true, SupportsImages: false}},
			Exporters:   []Exporter{{ID: "ndjson", Name: "NDJSON", Command: "export", Extension: "ndjson", ContentType: "application/x-ndjson"}},
		},
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"\"dataSources\"", "\"skills\"", "\"resources\"", "\"aiProviders\"", "\"supportsImages\":false", "\"exporters\""} {
		if !strings.Contains(string(raw), name) {
			t.Fatalf("missing %s in %s", name, raw)
		}
	}
	var decoded Manifest
	if err = json.Unmarshal(raw, &decoded); err != nil || decoded.Contributes == nil || len(decoded.Contributes.Exporters) != 1 || !decoded.Contributes.DataSources[0].ReadOnly {
		t.Fatal(err)
	}
}
