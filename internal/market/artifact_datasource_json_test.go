package market

import (
	"context"
	"strings"
	"testing"
)

func TestArtifactDataSourcesKeepStrictJSONBoundary(t *testing.T) {
	base := artifactDataSourceManifest(t, nil)
	cases := map[string]string{
		"duplicate readOnly":         strings.Replace(base, `"readOnly":true`, `"readOnly":false,"readOnly":true`, 1),
		"escaped duplicate readOnly": strings.Replace(base, `"readOnly":true`, `"readOnly":false,"\u0072eadOnly":true`, 1),
		"case alias readOnly":        strings.Replace(base, `"readOnly":true`, `"ReadOnly":true`, 1),
		"case duplicate readOnly":    strings.Replace(base, `"readOnly":true`, `"ReadOnly":false,"readOnly":true`, 1),
		"case alias collection":      strings.Replace(base, `"dataSources"`, `"datasources"`, 1),
		"null collection": artifactDataSourceManifest(t, func(fields map[string]any, _ map[string]any) {
			fields["contributes"].(map[string]any)["dataSources"] = nil
		}),
		"object collection": artifactDataSourceManifest(t, func(fields map[string]any, source map[string]any) {
			fields["contributes"].(map[string]any)["dataSources"] = source
		}),
		"null source": artifactDataSourceManifest(t, func(fields map[string]any, _ map[string]any) {
			fields["contributes"].(map[string]any)["dataSources"] = []any{nil}
		}),
		"unknown trusted field": artifactDataSourceManifest(t, func(_ map[string]any, source map[string]any) { source["official"] = true }),
	}
	for _, format := range []string{".zip", ".tgz"} {
		for name, manifest := range cases {
			t.Run(format+"/"+name, func(t *testing.T) {
				filename, _ := artifactDataSourceArchive(t, format, manifest)
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("datasource fields bypassed strict manifest JSON validation")
				}
			})
		}
	}
}

func TestArtifactDataSourcesPreserveLegacyContributions(t *testing.T) {
	cases := map[string]string{
		"original manifest":     artifactTestManifest,
		"empty datasource list": artifactTestChange(t, func(fields map[string]any) { fields["contributes"] = map[string]any{"dataSources": []any{}} }),
		"legacy mixed-case command": artifactTestChange(t, func(fields map[string]any) {
			fields["contributes"] = map[string]any{
				"commands": []any{map[string]any{"id": "9Legacy.Command", "title": "Legacy command"}},
				"panels":   []any{map[string]any{"id": "9Legacy.Panel", "title": "Legacy panel", "body": map[string]any{"type": "button", "command": "9Legacy.Command", "text": "Run"}}},
			}
		}),
	}
	for _, format := range []string{".zip", ".tgz"} {
		for name, manifest := range cases {
			t.Run(format+"/"+name, func(t *testing.T) {
				filename, _ := artifactDataSourceArchive(t, format, manifest)
				if _, err := ValidatePackage(context.Background(), filename); err != nil {
					t.Fatalf("legacy package changed behavior: %v", err)
				}
			})
		}
	}
}
