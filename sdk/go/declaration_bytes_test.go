package plugin

import (
	"strings"
	"testing"
)

func TestDeclarationNamesUseByteLimits(t *testing.T) {
	exact := strings.Repeat("中", 85)
	over := strings.Repeat("中", 86)
	source := DataSource{ID: "fixture", Name: exact, Dialect: "sqlite", ReadOnly: true}
	if err := ValidateDataSource(source); err != nil {
		t.Fatal(err)
	}
	source.Name = over
	if err := ValidateDataSource(source); err == nil {
		t.Fatal("data source name over 256 bytes was accepted")
	}
	exporter := Exporter{ID: "ndjson", Name: exact, Command: "render", Extension: "ndjson", ContentType: "application/x-ndjson"}
	if err := ValidateExporter(exporter); err != nil {
		t.Fatal(err)
	}
	exporter.Name = over
	if err := ValidateExporter(exporter); err == nil {
		t.Fatal("exporter name over 256 bytes was accepted")
	}
	provider := AIProvider{ID: "chat", Name: exact, Command: "generate", Models: []AIModel{{ID: "model", Name: exact, ContextWindow: 4096, MaxOutputTokens: 512}}}
	if err := ValidateAIProvider(provider); err != nil {
		t.Fatal(err)
	}
	provider.Name = over
	if err := ValidateAIProvider(provider); err == nil {
		t.Fatal("provider name over 256 bytes was accepted")
	}
	provider.Name = "Chat"
	provider.Models[0].Name = over
	if err := ValidateAIProvider(provider); err == nil {
		t.Fatal("model name over 256 bytes was accepted")
	}
}
