package market

import (
	"bytes"
	"context"
	"strconv"
	"strings"
	"testing"
)

func artifactAIProviderManifest(t *testing.T, change func(map[string]any, map[string]any, map[string]any)) string {
	t.Helper()
	return artifactTestChange(t, func(fields map[string]any) {
		model := map[string]any{"id": "test-model", "name": "Text model", "contextWindow": 8192, "maxOutputTokens": 1024}
		provider := map[string]any{"id": "chat", "name": "AI provider", "command": "Generate", "models": []any{model}, "supportsTools": true, "supportsImages": false}
		fields["id"] = "acme.aiprovider"
		fields["permissions"] = []string{"ai.providers"}
		fields["contributes"] = map[string]any{"commands": []any{map[string]any{"id": "Generate", "title": "Generation protocol", "effect": "unknown"}}, "aiProviders": []any{provider}}
		if change != nil {
			change(fields, provider, model)
		}
	})
}

func artifactAIProviderArchive(t *testing.T, format, manifest string) (string, []byte) {
	t.Helper()
	payload := artifactTestArchive(t, format, artifactTestEntries(manifest))
	return artifactTestWrite(t, format, payload), payload
}

func TestArtifactAIProvidersAcceptExplicitStaticModels(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any, map[string]any, map[string]any)
	}{
		{name: "tools"},
		{name: "text only", change: func(_ map[string]any, p map[string]any, _ map[string]any) { p["supportsTools"] = false }},
		{name: "image input", change: func(_ map[string]any, p map[string]any, _ map[string]any) { p["supportsImages"] = true }},
		{name: "minimum token limits", change: func(_ map[string]any, _ map[string]any, m map[string]any) {
			m["contextWindow"] = 1024
			m["maxOutputTokens"] = 1
			m["id"] = "0"
		}},
		{name: "maximum token limits", change: func(_ map[string]any, _ map[string]any, m map[string]any) {
			m["contextWindow"] = 262144
			m["maxOutputTokens"] = 65536
		}},
		{name: "maximum names and ids", change: func(_ map[string]any, p, m map[string]any) {
			p["id"] = strings.Repeat("p", 64)
			p["name"] = strings.Repeat("n", 256)
			m["id"] = strings.Repeat("M", 128)
			m["name"] = strings.Repeat("n", 256)
		}},
		{name: "utf8 name bound", change: func(_ map[string]any, p, m map[string]any) {
			p["name"] = strings.Repeat("界", 85)
			m["name"] = strings.Repeat("界", 85)
		}},
		{name: "model punctuation", change: func(_ map[string]any, p, m map[string]any) {
			p["id"] = "chat.main_v1-text"
			m["id"] = "Org/Model.v1:Q4_K@stable+-"
			p["name"] = "文本提供方"
			m["name"] = "文本模型"
		}},
		{name: "case sensitive model ids", change: func(_ map[string]any, p, m map[string]any) {
			p["models"] = []any{m, map[string]any{"id": "TEST-model", "name": "Other", "contextWindow": 8192, "maxOutputTokens": 1024}}
		}},
		{name: "eight providers thirty two models", change: fillArtifactAIProviderBounds},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				manifest := artifactAIProviderManifest(t, test.change)
				filename, payload := artifactAIProviderArchive(t, format, manifest)
				validated, err := ValidatePackage(context.Background(), filename)
				if err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(validated.Manifest, []byte(manifest)) || validated.SHA256 != artifactTestDigest(payload) || validated.SizeBytes != int64(len(payload)) {
					t.Fatal("AI declaration validation changed archive or manifest bytes")
				}
			})
		}
	}
}

func fillArtifactAIProviderBounds(fields, provider, model map[string]any) {
	models := make([]any, 0, 32)
	for i := 0; i < 32; i++ {
		models = append(models, map[string]any{"id": "model" + strconv.Itoa(i), "name": model["name"], "contextWindow": 8192, "maxOutputTokens": 1024})
	}
	providers := make([]any, 0, 8)
	for i := 0; i < 8; i++ {
		providers = append(providers, map[string]any{"id": "provider" + strconv.Itoa(i), "name": provider["name"], "command": "Generate", "models": models, "supportsTools": true, "supportsImages": false})
	}
	fields["contributes"].(map[string]any)["aiProviders"] = providers
}

func TestArtifactAIProvidersRejectInvalidProviderMetadata(t *testing.T) {
	cases := []struct {
		name  string
		patch map[string]any
	}{
		{name: "empty id", patch: map[string]any{"id": ""}},
		{name: "upper id", patch: map[string]any{"id": "Chat"}},
		{name: "colon id", patch: map[string]any{"id": "chat:remote"}},
		{name: "digit prefix", patch: map[string]any{"id": "1chat"}},
		{name: "whitespace id", patch: map[string]any{"id": " chat"}},
		{name: "long id", patch: map[string]any{"id": strings.Repeat("a", 65)}},
		{name: "blank name", patch: map[string]any{"name": " \t\n"}},
		{name: "long name", patch: map[string]any{"name": strings.Repeat("a", 257)}},
		{name: "name byte limit", patch: map[string]any{"name": strings.Repeat("界", 86)}},
		{name: "nul name", patch: map[string]any{"name": "secret\x00"}},
		{name: "unknown command", patch: map[string]any{"command": "Missing"}},
		{name: "case changed command", patch: map[string]any{"command": "generate"}},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				manifest := artifactAIProviderManifest(t, func(_ map[string]any, p map[string]any, _ map[string]any) {
					for key, value := range test.patch {
						p[key] = value
					}
				})
				filename, _ := artifactAIProviderArchive(t, format, manifest)
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("accepted invalid provider declaration")
				}
			})
		}
	}
}

func TestArtifactAIProvidersRejectInvalidModelMetadata(t *testing.T) {
	cases := []struct {
		name  string
		patch map[string]any
	}{
		{name: "empty id", patch: map[string]any{"id": ""}},
		{name: "spaces", patch: map[string]any{"id": "remote model"}},
		{name: "nonascii id", patch: map[string]any{"id": "模型"}},
		{name: "leading symbol", patch: map[string]any{"id": "/model"}},
		{name: "invalid symbol", patch: map[string]any{"id": "model?key"}},
		{name: "long id", patch: map[string]any{"id": strings.Repeat("M", 129)}},
		{name: "blank name", patch: map[string]any{"name": "\n"}},
		{name: "long name", patch: map[string]any{"name": strings.Repeat("a", 257)}},
		{name: "name byte limit", patch: map[string]any{"name": strings.Repeat("界", 86)}},
		{name: "nul name", patch: map[string]any{"name": "model\x00"}},
		{name: "small context", patch: map[string]any{"contextWindow": 1023}},
		{name: "large context", patch: map[string]any{"contextWindow": 262145}},
		{name: "negative context", patch: map[string]any{"contextWindow": -1}},
		{name: "zero output", patch: map[string]any{"maxOutputTokens": 0}},
		{name: "negative output", patch: map[string]any{"maxOutputTokens": -1}},
		{name: "large output", patch: map[string]any{"maxOutputTokens": 65537}},
		{name: "output exceeds context", patch: map[string]any{"contextWindow": 1024, "maxOutputTokens": 1025}},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				manifest := artifactAIProviderManifest(t, func(_ map[string]any, _ map[string]any, m map[string]any) {
					for key, value := range test.patch {
						m[key] = value
					}
				})
				filename, _ := artifactAIProviderArchive(t, format, manifest)
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("accepted invalid model declaration")
				}
			})
		}
	}
}
