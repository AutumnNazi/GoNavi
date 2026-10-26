package market

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

func TestArtifactAIProvidersRequireBackendPermissionAndUniqueBoundedLists(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any, map[string]any, map[string]any)
	}{
		{name: "missing permission", change: func(f, p, m map[string]any) { f["permissions"] = []string{} }},
		{name: "tools permission is not providers", change: func(f, p, m map[string]any) { f["permissions"] = []string{"ai.tools"} }},
		{name: "near match permission", change: func(f, p, m map[string]any) { f["permissions"] = []string{"ai.providers.read"} }},
		{name: "missing backend", change: func(f, p, m map[string]any) {
			delete(f, "backend")
			f["contributes"].(map[string]any)["commands"] = []any{}
		}},
		{name: "missing command declaration", change: func(f, p, m map[string]any) { f["contributes"].(map[string]any)["commands"] = []any{} }},
		{name: "duplicate provider ids", change: func(f, p, m map[string]any) { f["contributes"].(map[string]any)["aiProviders"] = []any{p, p} }},
		{name: "nine providers", change: func(f, p, m map[string]any) {
			providers := make([]any, 0, 9)
			for i := 0; i < 9; i++ {
				providers = append(providers, map[string]any{"id": "p" + strconv.Itoa(i), "name": p["name"], "command": p["command"], "models": p["models"], "supportsTools": true, "supportsImages": false})
			}
			f["contributes"].(map[string]any)["aiProviders"] = providers
		}},
		{name: "no models", change: func(f, p, m map[string]any) { p["models"] = []any{} }},
		{name: "duplicate model ids", change: func(f, p, m map[string]any) { p["models"] = []any{m, m} }},
		{name: "thirty three models", change: func(f, p, m map[string]any) {
			models := make([]any, 0, 33)
			for i := 0; i < 33; i++ {
				models = append(models, map[string]any{"id": "m" + strconv.Itoa(i), "name": m["name"], "contextWindow": 8192, "maxOutputTokens": 1024})
			}
			p["models"] = models
		}},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				filename, _ := artifactAIProviderArchive(t, format, artifactAIProviderManifest(t, test.change))
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("accepted invalid provider permission/backend/list declaration")
				}
			})
		}
	}
}

func TestArtifactAIProvidersStrictJSONRequiredFields(t *testing.T) {
	cases := make(map[string]string)
	for _, field := range []string{"id", "name", "command", "models", "supportsTools", "supportsImages"} {
		cases["provider missing "+field] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { delete(p, field) })
		cases["provider null "+field] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { p[field] = nil })
		cases["provider object "+field] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { p[field] = map[string]any{} })
	}
	for _, field := range []string{"id", "name", "contextWindow", "maxOutputTokens"} {
		cases["model missing "+field] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { delete(m, field) })
		cases["model null "+field] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { m[field] = nil })
		cases["model bool "+field] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { m[field] = false })
	}
	cases["providers null"] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { f["contributes"].(map[string]any)["aiProviders"] = nil })
	cases["providers object"] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { f["contributes"].(map[string]any)["aiProviders"] = p })
	cases["provider element null"] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { f["contributes"].(map[string]any)["aiProviders"] = []any{nil} })
	cases["model element null"] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { p["models"] = []any{nil} })
	cases["tools string"] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { p["supportsTools"] = "false" })
	cases["images number"] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { p["supportsImages"] = 0 })
	cases["unknown provider field"] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { p["apiKey"] = "not-a-real-secret" })
	cases["unknown model field"] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { m["supportsTools"] = true })
	for _, value := range []any{"1024", json.Number("1024.0"), json.Number("1.024e3"), json.Number("1024.5"), json.Number("9007199254740993"), json.Number("9223372036854775808")} {
		cases["context numeric "+string(mustJSON(t, value))] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { m["contextWindow"] = value })
		cases["output numeric "+string(mustJSON(t, value))] = artifactAIProviderManifest(t, func(f, p, m map[string]any) { m["maxOutputTokens"] = value })
	}
	assertArtifactAIProviderManifestRejections(t, cases)
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestArtifactAIProvidersRejectDuplicateCaseAndUnknownJSONKeys(t *testing.T) {
	manifest := artifactAIProviderManifest(t, nil)
	cases := map[string]string{
		"provider array case":             strings.Replace(manifest, "\"aiProviders\":", "\"AIProviders\":", 1),
		"duplicate array":                 strings.Replace(manifest, "\"aiProviders\":", "\"aiProviders\":[],\"aiProviders\":", 1),
		"duplicate flag":                  strings.Replace(manifest, "\"supportsTools\":true", "\"supportsTools\":true,\"supportsTools\":false", 1),
		"escaped duplicate flag":          strings.Replace(manifest, "\"supportsTools\":true", "\"supportsTools\":true,\"supports\\u0054ools\":false", 1),
		"flag case":                       strings.Replace(manifest, "\"supportsImages\":false", "\"SupportsImages\":false", 1),
		"duplicate model id":              strings.Replace(manifest, "\"id\":\"test-model\"", "\"id\":\"test-model\",\"id\":\"other\"", 1),
		"escaped duplicate model context": strings.Replace(manifest, "\"contextWindow\":8192", "\"contextWindow\":8192,\"context\\u0057indow\":8192", 1),
		"model case":                      strings.Replace(manifest, "\"maxOutputTokens\":1024", "\"MaxOutputTokens\":1024", 1),
		"nonfinite context":               strings.Replace(manifest, "\"contextWindow\":8192", "\"contextWindow\":NaN", 1),
		"invalid utf8":                    strings.Replace(manifest, "\"AI provider\"", string([]byte{'"', 0xff, '"'}), 1),
	}
	assertArtifactAIProviderManifestRejections(t, cases)
}

func assertArtifactAIProviderManifestRejections(t *testing.T, cases map[string]string) {
	t.Helper()
	for _, format := range []string{".zip", ".tgz"} {
		for name, manifest := range cases {
			t.Run(format+"/"+name, func(t *testing.T) {
				filename, _ := artifactAIProviderArchive(t, format, manifest)
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("accepted malformed or ambiguous AI provider JSON")
				}
			})
		}
	}
}
