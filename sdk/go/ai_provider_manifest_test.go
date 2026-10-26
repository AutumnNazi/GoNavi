package plugin

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAIProviderManifestCapabilitiesAreExplicit(t *testing.T) {
	provider := AIProvider{ID: "demo", Name: "Demo", Command: "generate", Models: []AIModel{{ID: "model/A:1", Name: "Model", ContextWindow: 4096, MaxOutputTokens: 512}}}
	raw, err := json.Marshal(provider)
	if err != nil {
		t.Fatal(err)
	}
	for _, flag := range []string{`"supportsTools":false`, `"supportsImages":false`} {
		if !strings.Contains(string(raw), flag) {
			t.Fatalf("capability omitted: %s", raw)
		}
	}
	var decoded AIProvider
	if err = json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Models) != 1 || decoded.Models[0] != provider.Models[0] {
		t.Fatal("static model did not roundtrip")
	}
	manifest := Manifest{SchemaVersion: 1, APIVersion: 1, ID: "example.ai", Name: "Example", Version: "1.0.0", Permissions: []string{"ai.providers"}, Contributes: &Contributions{AIProviders: []AIProvider{provider}}}
	raw, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"aiProviders"`) || strings.Contains(string(raw), `"panels":null`) {
		t.Fatalf("incorrect contribution wire shape: %s", raw)
	}
}
