package market

import (
	"bytes"
	"context"
	"strconv"
	"strings"
	"testing"
)

func artifactExporterManifest(t *testing.T, change func(map[string]any, map[string]any)) string {
	t.Helper()
	return artifactTestChange(t, func(fields map[string]any) {
		exporter := map[string]any{"id": "ndjson", "name": "NDJSON export", "command": "Render", "extension": "ndjson", "contentType": "application/x-ndjson"}
		fields["id"] = "acme.exporter"
		fields["permissions"] = []string{"data.export"}
		fields["contributes"] = map[string]any{"commands": []any{map[string]any{"id": "Render", "title": "Render snapshot", "effect": "unknown"}}, "exporters": []any{exporter}}
		if change != nil {
			change(fields, exporter)
		}
	})
}

func artifactExporterArchive(t *testing.T, format, manifest string) (string, []byte) {
	t.Helper()
	payload := artifactTestArchive(t, format, artifactTestEntries(manifest))
	return artifactTestWrite(t, format, payload), payload
}

func TestArtifactExportersAcceptBoundedDeclarations(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any, map[string]any)
	}{
		{name: "default"},
		{name: "text", change: func(f, e map[string]any) { e["contentType"] = "text/plain"; e["extension"] = "txt" }},
		{name: "vendor", change: func(f, e map[string]any) { e["contentType"] = "application/vnd.acme+json" }},
		{name: "numeric extension and subtype", change: func(f, e map[string]any) { e["extension"] = "7z"; e["contentType"] = "application/7z" }},
		{name: "maximum strings", change: func(f, e map[string]any) {
			e["id"] = strings.Repeat("a", 64)
			e["name"] = strings.Repeat("n", 256)
			e["extension"] = strings.Repeat("a", 16)
			e["contentType"] = "application/" + strings.Repeat("a", 64)
		}},
		{name: "unicode name", change: func(f, e map[string]any) { e["name"] = "导出格式"; e["id"] = "export.main_v1-text" }},
		{name: "utf8 name bound", change: func(f, e map[string]any) { e["name"] = strings.Repeat("界", 85) }},
		{name: "write command effect", change: func(f, e map[string]any) {
			f["contributes"].(map[string]any)["commands"] = []any{map[string]any{"id": "Render", "title": "Render", "effect": "write"}}
		}},
		{name: "streaming declaration", change: func(f, e map[string]any) { e["streaming"] = true }},
		{name: "eight shared commands", change: func(f, e map[string]any) { setArtifactExporters(f, e, 8) }},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				manifest := artifactExporterManifest(t, test.change)
				filename, payload := artifactExporterArchive(t, format, manifest)
				validated, err := ValidatePackage(context.Background(), filename)
				if err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(validated.Manifest, []byte(manifest)) || validated.SHA256 != artifactTestDigest(payload) || validated.SizeBytes != int64(len(payload)) {
					t.Fatal("exporter validation changed immutable manifest/artifact bytes")
				}
			})
		}
	}
}

func setArtifactExporters(fields, exporter map[string]any, count int) {
	exporters := make([]any, 0, count)
	for i := 0; i < count; i++ {
		exporters = append(exporters, map[string]any{"id": "exporter" + strconv.Itoa(i), "name": exporter["name"], "command": exporter["command"], "extension": exporter["extension"], "contentType": exporter["contentType"]})
	}
	fields["contributes"].(map[string]any)["exporters"] = exporters
}

func TestArtifactExportersRejectInvalidMetadata(t *testing.T) {
	cases := []struct{ name, field, value string }{
		{"empty id", "id", ""}, {"upper id", "id", "Export"}, {"digit id prefix", "id", "1export"}, {"colon id", "id", "export:local"}, {"slash id", "id", "path/export"},
		{"long id", "id", strings.Repeat("a", 65)}, {"line id", "id", "export\n"}, {"unicode id", "id", "导出"},
		{"blank name", "name", " \t\n"}, {"long name", "name", strings.Repeat("a", 257)}, {"utf8 byte name", "name", strings.Repeat("界", 86)}, {"nul name", "name", "name\x00"},
		{"missing command", "command", "Missing"}, {"wrong command case", "command", "render"}, {"empty command", "command", ""},
		{"empty extension", "extension", ""}, {"dotted extension", "extension", ".csv"}, {"multiple extension", "extension", "tar.gz"}, {"path extension", "extension", "../csv"},
		{"upper extension", "extension", "CSV"}, {"long extension", "extension", strings.Repeat("a", 17)}, {"space extension", "extension", " csv"}, {"line extension", "extension", "csv\n"},
		{"unicode extension", "extension", "表"}, {"underscore extension", "extension", "my_ext"}, {"hyphen extension", "extension", "my-ext"},
		{"empty mime", "contentType", ""}, {"image mime", "contentType", "image/svg+xml"}, {"upper family", "contentType", "Text/plain"}, {"upper subtype", "contentType", "text/Plain"},
		{"mime parameters", "contentType", "application/json; charset=utf-8"}, {"mime space", "contentType", "text/plain "}, {"mime line", "contentType", "text/plain\n"},
		{"mime extra slash", "contentType", "text/a/b"}, {"mime invalid prefix", "contentType", "text/.json"}, {"mime long subtype", "contentType", "text/" + strings.Repeat("a", 65)},
		{"mime underscore", "contentType", "text/my_type"}, {"mime unicode", "contentType", "text/文本"},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				manifest := artifactExporterManifest(t, func(f, e map[string]any) { e[test.field] = test.value })
				filename, _ := artifactExporterArchive(t, format, manifest)
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("invalid exporter declaration was accepted")
				}
			})
		}
	}
}

func TestArtifactExportersRequirePermissionBackendAndDeclaredCommands(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any, map[string]any)
	}{
		{name: "permission missing", change: func(f, e map[string]any) { f["permissions"] = []string{} }},
		{name: "tools is not export", change: func(f, e map[string]any) { f["permissions"] = []string{"ai.tools"} }},
		{name: "near permission", change: func(f, e map[string]any) { f["permissions"] = []string{"data.exports"} }},
		{name: "backend missing", change: func(f, e map[string]any) {
			delete(f, "backend")
			f["contributes"].(map[string]any)["commands"] = []any{}
		}},
		{name: "no declared command", change: func(f, e map[string]any) { f["contributes"].(map[string]any)["commands"] = []any{} }},
		{name: "duplicate ids", change: func(f, e map[string]any) { f["contributes"].(map[string]any)["exporters"] = []any{e, e} }},
		{name: "nine exporters", change: func(f, e map[string]any) { setArtifactExporters(f, e, 9) }},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				filename, _ := artifactExporterArchive(t, format, artifactExporterManifest(t, test.change))
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("exporter prerequisite validation was bypassed")
				}
			})
		}
	}
}

func TestArtifactExportersRejectNonBooleanStreaming(t *testing.T) {
	for _, value := range []any{"true", float64(1), nil} {
		filename, _ := artifactExporterArchive(t, ".zip", artifactExporterManifest(t, func(f, e map[string]any) { e["streaming"] = value }))
		if _, err := ValidatePackage(context.Background(), filename); err == nil {
			t.Fatalf("non-boolean streaming %v was accepted", value)
		}
	}
}
