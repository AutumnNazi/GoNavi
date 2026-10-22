package market

import (
	"context"
	"strings"
	"testing"
)

func TestArtifactExportersRejectMalformedJSON(t *testing.T) {
	cases := make(map[string]string)
	for _, field := range []string{"id", "name", "command", "extension", "contentType"} {
		cases["missing "+field] = artifactExporterManifest(t, func(f, e map[string]any) { delete(e, field) })
		cases["null "+field] = artifactExporterManifest(t, func(f, e map[string]any) { e[field] = nil })
		cases["number "+field] = artifactExporterManifest(t, func(f, e map[string]any) { e[field] = 1 })
		cases["object "+field] = artifactExporterManifest(t, func(f, e map[string]any) { e[field] = map[string]any{} })
	}
	cases["null array"] = artifactExporterManifest(t, func(f, e map[string]any) { f["contributes"].(map[string]any)["exporters"] = nil })
	cases["object array"] = artifactExporterManifest(t, func(f, e map[string]any) { f["contributes"].(map[string]any)["exporters"] = e })
	cases["null element"] = artifactExporterManifest(t, func(f, e map[string]any) { f["contributes"].(map[string]any)["exporters"] = []any{nil} })
	cases["unknown path"] = artifactExporterManifest(t, func(f, e map[string]any) { e["filePath"] = "not-a-filesystem-grant" })
	manifest := artifactExporterManifest(t, nil)
	for name, patch := range map[string][2]string{
		"array case":           {`"exporters":`, `"Exporters":`},
		"array duplicate":      {`"exporters":`, `"exporters":[],"exporters":`},
		"field case":           {`"extension":"ndjson"`, `"Extension":"ndjson"`},
		"field duplicate":      {`"extension":"ndjson"`, `"extension":"ndjson","extension":"csv"`},
		"escaped duplicate":    {`"extension":"ndjson"`, `"extension":"ndjson","exten\u0073ion":"csv"`},
		"content case":         {`"contentType":"application/x-ndjson"`, `"ContentType":"application/x-ndjson"`},
		"escaped id duplicate": {`"id":"ndjson"`, `"id":"ndjson","\u0069d":"other"`},
	} {
		cases[name] = strings.Replace(manifest, patch[0], patch[1], 1)
	}
	cases["invalid utf8"] = strings.Replace(manifest, `"NDJSON export"`, string([]byte{'"', 0xff, '"'}), 1)
	for _, format := range []string{".zip", ".tgz"} {
		for name, manifest := range cases {
			t.Run(format+"/"+name, func(t *testing.T) {
				filename, _ := artifactExporterArchive(t, format, manifest)
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("ambiguous or malformed exporter JSON accepted")
				}
			})
		}
	}
}

func TestArtifactExportersPreserveLegacyAndManifestBounds(t *testing.T) {
	valid := artifactExporterManifest(t, nil)
	cases := map[string]string{
		"legacy":                  artifactTestManifest,
		"empty exporters":         artifactTestChange(t, func(f map[string]any) { delete(f, "backend"); f["contributes"] = map[string]any{"exporters": []any{}} }),
		"single canonical escape": strings.Replace(valid, `"contentType":`, `"content\u0054ype":`, 1),
		"maximum manifest":        valid + strings.Repeat(" ", maxArtifactManifestBytes-len(valid)),
	}
	for _, format := range []string{".zip", ".tgz"} {
		for name, manifest := range cases {
			t.Run(format+"/"+name, func(t *testing.T) {
				filename, _ := artifactExporterArchive(t, format, manifest)
				if _, err := ValidatePackage(context.Background(), filename); err != nil {
					t.Fatal(err)
				}
			})
		}
		t.Run(format+"/oversized manifest", func(t *testing.T) {
			filename, _ := artifactExporterArchive(t, format, cases["maximum manifest"]+" ")
			if _, err := ValidatePackage(context.Background(), filename); err == nil {
				t.Fatal("exporter bypassed whole-manifest size cap")
			}
		})
	}
}

func TestArtifactExportersKeepContributionNamespacesIndependent(t *testing.T) {
	manifest := artifactExporterManifest(t, func(f, e map[string]any) {
		f["permissions"] = []string{"data.export", "data.sources", "ai.skills", "ai.providers"}
		e["id"] = "shared"
		c := f["contributes"].(map[string]any)
		c["dataSources"] = []any{map[string]any{"id": "shared", "name": "Read-only data", "dialect": "sqlite", "command": "Render", "readOnly": true}}
		c["skills"] = []any{map[string]any{"id": "shared", "name": "Guidance", "description": "Static guidance", "entry": artifactSkillTestEntry}}
		c["aiProviders"] = []any{map[string]any{"id": "shared", "name": "Text provider", "command": "Render", "supportsTools": false, "supportsImages": false, "models": []any{map[string]any{"id": "model", "name": "Model", "contextWindow": 2048, "maxOutputTokens": 128}}}}
	})
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format, func(t *testing.T) {
			entries := append(artifactTestEntries(manifest), artifactTestEntry{name: artifactSkillTestEntry, body: []byte("Static guidance")})
			filename := artifactTestWrite(t, format, artifactTestArchive(t, format, entries))
			if _, err := ValidatePackage(context.Background(), filename); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestArtifactExportersRequireActualBackendEntry(t *testing.T) {
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format, func(t *testing.T) {
			payload := artifactTestArchive(t, format, []artifactTestEntry{{name: artifactManifestName, body: []byte(artifactExporterManifest(t, nil))}})
			if _, err := ValidatePackage(context.Background(), artifactTestWrite(t, format, payload)); err == nil {
				t.Fatal("missing backend entry accepted")
			}
		})
	}
}
