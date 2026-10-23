package market

import (
	"context"
	"strings"
	"testing"
)

func TestArtifactAIProvidersPreserveLegacyAndCanonicalEscapes(t *testing.T) {
	normal := artifactAIProviderManifest(t, nil)
	cases := map[string]string{
		"legacy": artifactTestManifest,
		"empty providers": artifactTestChange(t, func(f map[string]any) {
			delete(f, "backend")
			f["contributes"] = map[string]any{"aiProviders": []any{}}
		}),
		"escaped canonical flag":      strings.Replace(normal, "\"supportsTools\":", "\"supports\\u0054ools\":", 1),
		"escaped canonical model key": strings.Replace(normal, "\"contextWindow\":", "\"context\\u0057indow\":", 1),
		"write command effect": artifactAIProviderManifest(t, func(f, p, m map[string]any) {
			f["contributes"].(map[string]any)["commands"] = []any{map[string]any{"id": "Generate", "title": "Generation", "effect": "write"}}
		}),
	}
	for _, format := range []string{".zip", ".tgz"} {
		for name, manifest := range cases {
			t.Run(format+"/"+name, func(t *testing.T) {
				filename, _ := artifactAIProviderArchive(t, format, manifest)
				if _, err := ValidatePackage(context.Background(), filename); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestArtifactAIProvidersKeepSourceSkillAndCommandNamespacesIndependent(t *testing.T) {
	manifest := artifactAIProviderManifest(t, func(fields, provider, model map[string]any) {
		fields["permissions"] = []string{"ai.providers", "data.sources", "ai.skills"}
		contributions := fields["contributes"].(map[string]any)
		contributions["commands"] = []any{map[string]any{"id": "Generate", "title": "Protocol", "effect": "unknown"}, map[string]any{"id": "chat", "title": "Ordinary command", "effect": "read"}}
		contributions["dataSources"] = []any{map[string]any{"id": "chat", "name": "Read-only data", "dialect": "sqlite", "command": "Generate", "readOnly": true}}
		contributions["skills"] = []any{map[string]any{"id": "chat", "name": "Guidance", "description": "Read-only guidance", "entry": artifactSkillTestEntry}}
	})
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format, func(t *testing.T) {
			entries := append(artifactTestEntries(manifest), artifactTestEntry{name: artifactSkillTestEntry, body: []byte("Guidance, not runtime authority")})
			filename := artifactTestWrite(t, format, artifactTestArchive(t, format, entries))
			if _, err := ValidatePackage(context.Background(), filename); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestArtifactAIProvidersRequireActualBackendPackageEntry(t *testing.T) {
	manifest := artifactAIProviderManifest(t, nil)
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format, func(t *testing.T) {
			payload := artifactTestArchive(t, format, []artifactTestEntry{{name: artifactManifestName, body: []byte(manifest)}})
			if _, err := ValidatePackage(context.Background(), artifactTestWrite(t, format, payload)); err == nil {
				t.Fatal("accepted provider whose backend entry is missing")
			}
		})
	}
}
