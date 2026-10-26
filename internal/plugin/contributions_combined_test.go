package plugin

import (
	"encoding/json"
	"testing"
)

func TestCombinedContributionsParse(t *testing.T) {
	manifest := basicManifest("example.bundle")
	manifest.Permissions = []string{"data.sources", "ai.skills", "ai.providers", "data.export"}
	manifest.Backend = &Backend{Default: &Entry{Executable: "plugin", Runtime: "native"}}
	manifest.Contributes.Commands = []Command{{ID: "db", Title: "DB"}, {ID: "chat", Title: "Chat"}, {ID: "render", Title: "Render"}}
	manifest.Contributes.DataSources = []DataSource{{ID: "db", Name: "DB", Dialect: "sqlite", Command: "db", ReadOnly: true}}
	manifest.Contributes.Skills = []Skill{{ID: "guide", Name: "Guide", Description: "Read", Entry: "SKILL.md", Resources: []string{"NOTES.md"}}}
	manifest.Contributes.AIProviders = []AIProvider{{ID: "chat", Name: "Chat", Command: "chat", Models: []AIModel{{ID: "model-a", Name: "Model", ContextWindow: 4096, MaxOutputTokens: 512}}, SupportsTools: true}}
	manifest.Contributes.Exporters = []Exporter{{ID: "ndjson", Name: "NDJSON", Command: "render", Extension: "ndjson", ContentType: "application/x-ndjson"}}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseManifest(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.Contributes.DataSources) != 1 || len(parsed.Contributes.Skills) != 1 || len(parsed.Contributes.AIProviders) != 1 || len(parsed.Contributes.Exporters) != 1 {
		t.Fatalf("combined contributions dropped: %+v", parsed.Contributes)
	}
	manifest.Contributes.AIProviders[0].SupportsImages = true
	raw, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ParseManifest(raw); err != nil {
		t.Fatalf("image provider was rejected: %v", err)
	}
}
