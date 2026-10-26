package plugin

import (
	"strings"
	"testing"
)

func TestAIProviderNameByteBounds(t *testing.T) {
	provider := AIProvider{
		ID: "demo", Name: strings.Repeat("中", 85), Command: "generate",
		Models: []AIModel{{ID: "model-a", Name: strings.Repeat("界", 85), ContextWindow: 4096, MaxOutputTokens: 512}},
	}
	if err := ValidateAIProvider(provider); err != nil {
		t.Fatal(err)
	}
	provider.Name = strings.Repeat("中", 86)
	if ValidateAIProvider(provider) == nil {
		t.Fatal("provider name over 256 bytes was accepted")
	}
	provider.Name = "Demo"
	provider.Models[0].Name = strings.Repeat("界", 86)
	if ValidateAIProvider(provider) == nil {
		t.Fatal("model name over 256 bytes was accepted")
	}
	provider.Models[0].Name = "Model"
	provider.SupportsImages = true
	if ValidateAIProvider(provider) == nil {
		t.Fatal("image input was accepted")
	}
}
