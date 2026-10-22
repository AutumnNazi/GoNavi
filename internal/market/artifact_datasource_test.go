package market

import (
	"bytes"
	"context"
	"strconv"
	"strings"
	"testing"
)

func artifactDataSourceManifest(t *testing.T, change func(map[string]any, map[string]any)) string {
	t.Helper()
	return artifactTestChange(t, func(fields map[string]any) {
		source := map[string]any{"id": "database", "name": "Read-only database", "dialect": "postgres", "command": "Driver", "defaultPort": 5432, "readOnly": true}
		fields["id"] = "acme.datasource"
		fields["permissions"] = []string{"data.sources"}
		fields["contributes"] = map[string]any{
			"commands":    []any{map[string]any{"id": "Driver", "title": "Database protocol", "effect": "unknown"}},
			"dataSources": []any{source},
		}
		if change != nil {
			change(fields, source)
		}
	})
}

func artifactDataSourceArchive(t *testing.T, format, manifest string) (string, []byte) {
	t.Helper()
	payload := artifactTestArchive(t, format, artifactTestEntries(manifest))
	return artifactTestWrite(t, format, payload), payload
}

func TestArtifactDataSourcesAcceptReadOnlyDeclarations(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any, map[string]any)
	}{
		{name: "postgres"},
		{name: "mysql", change: func(_ map[string]any, source map[string]any) { source["dialect"] = "mysql" }},
		{name: "sqlite", change: func(_ map[string]any, source map[string]any) { source["dialect"] = "sqlite" }},
		{name: "omitted port", change: func(_ map[string]any, source map[string]any) { delete(source, "defaultPort") }},
		{name: "zero port", change: func(_ map[string]any, source map[string]any) { source["defaultPort"] = 0 }},
		{name: "minimum port", change: func(_ map[string]any, source map[string]any) { source["defaultPort"] = 1 }},
		{name: "maximum port", change: func(_ map[string]any, source map[string]any) { source["defaultPort"] = 65535 }},
		{name: "maximum id", change: func(_ map[string]any, source map[string]any) { source["id"] = strings.Repeat("a", 64) }},
		{name: "local id punctuation", change: func(_ map[string]any, source map[string]any) { source["id"] = "db.v1_read-only" }},
		{name: "maximum name", change: func(_ map[string]any, source map[string]any) { source["name"] = strings.Repeat("n", 256) }},
		{name: "utf8 name bound", change: func(_ map[string]any, source map[string]any) { source["name"] = strings.Repeat("界", 85) }},
		{name: "separate contribution namespaces", change: func(fields map[string]any, source map[string]any) {
			source["id"] = "driver"
			source["command"] = "driver"
			contributions := fields["contributes"].(map[string]any)
			contributions["commands"] = []any{map[string]any{"id": "driver", "title": "Driver", "effect": "read"}}
			contributions["panels"] = []any{map[string]any{"id": "driver", "title": "Driver", "body": map[string]any{"type": "text", "text": "Status"}}}
		}},
		{name: "eight sources", change: func(fields map[string]any, source map[string]any) {
			sources := make([]any, 0, 8)
			for i := 0; i < 8; i++ {
				sources = append(sources, map[string]any{"id": "database" + strconv.Itoa(i), "name": source["name"], "dialect": source["dialect"], "command": source["command"], "readOnly": true})
			}
			fields["contributes"].(map[string]any)["dataSources"] = sources
		}},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				manifest := artifactDataSourceManifest(t, test.change)
				filename, payload := artifactDataSourceArchive(t, format, manifest)
				inspected, err := ValidatePackage(context.Background(), filename)
				if err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(inspected.Manifest, []byte(manifest)) || inspected.SHA256 != artifactTestDigest(payload) || inspected.SizeBytes != int64(len(payload)) {
					t.Fatal("datasource validation changed exact manifest or archive bytes")
				}
			})
		}
	}
}

func TestArtifactDataSourcesRejectInvalidDeclarations(t *testing.T) {
	cases := []struct {
		name, key string
		value     any
		remove    bool
	}{
		{name: "missing id", key: "id", remove: true}, {name: "empty id", key: "id", value: ""},
		{name: "uppercase id", key: "id", value: "Database"}, {name: "colon id", key: "id", value: "database:postgres"},
		{name: "leading digit", key: "id", value: "1database"}, {name: "space id", key: "id", value: "data base"},
		{name: "slash id", key: "id", value: "data/base"}, {name: "unicode id", key: "id", value: "数据库"},
		{name: "oversized id", key: "id", value: strings.Repeat("a", 65)},
		{name: "missing name", key: "name", remove: true}, {name: "blank name", key: "name", value: " "},
		{name: "nul name", key: "name", value: "data" + string(rune(0))}, {name: "oversized name", key: "name", value: strings.Repeat("n", 257)}, {name: "utf8 name bound", key: "name", value: strings.Repeat("界", 86)},
		{name: "missing dialect", key: "dialect", remove: true}, {name: "unsupported dialect", key: "dialect", value: "oracle"},
		{name: "dialect alias", key: "dialect", value: "postgresql"}, {name: "dialect case", key: "dialect", value: "Postgres"},
		{name: "missing command", key: "command", remove: true}, {name: "unknown command", key: "command", value: "Unknown"},
		{name: "command case mismatch", key: "command", value: "driver"}, {name: "empty command", key: "command", value: ""},
		{name: "readonly omitted", key: "readOnly", remove: true}, {name: "readonly false", key: "readOnly", value: false},
		{name: "readonly null", key: "readOnly", value: nil}, {name: "readonly string", key: "readOnly", value: "true"},
		{name: "readonly number", key: "readOnly", value: 1},
		{name: "negative port", key: "defaultPort", value: -1}, {name: "oversized port", key: "defaultPort", value: 65536},
		{name: "fractional port", key: "defaultPort", value: 1.5}, {name: "string port", key: "defaultPort", value: "5432"},
		{name: "null port", key: "defaultPort", value: nil}, {name: "unknown property", key: "execute", value: true},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				manifest := artifactDataSourceManifest(t, func(_ map[string]any, source map[string]any) {
					if test.remove {
						delete(source, test.key)
					} else {
						source[test.key] = test.value
					}
				})
				filename, _ := artifactDataSourceArchive(t, format, manifest)
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("accepted invalid datasource declaration")
				}
			})
		}
	}
}

func TestArtifactDataSourceRejectsWriteEffect(t *testing.T) {
	manifest := artifactDataSourceManifest(t, func(fields map[string]any, _ map[string]any) {
		commands := fields["contributes"].(map[string]any)["commands"].([]any)
		commands[0].(map[string]any)["effect"] = "WRITE"
	})
	filename, _ := artifactDataSourceArchive(t, ".zip", manifest)
	if _, err := ValidatePackage(context.Background(), filename); err == nil {
		t.Fatal("write effect was accepted")
	}
}

func TestArtifactDataSourcesRequireOwnedBackendAndPermission(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any, map[string]any)
	}{
		{name: "missing permission", change: func(fields map[string]any, _ map[string]any) { fields["permissions"] = []string{"db.read"} }},
		{name: "permission namespace alias", change: func(fields map[string]any, _ map[string]any) { fields["permissions"] = []string{"data.sources.read"} }},
		{name: "backend omitted", change: func(fields map[string]any, _ map[string]any) { delete(fields, "backend") }},
		{name: "empty backend", change: func(fields map[string]any, _ map[string]any) { fields["backend"] = map[string]any{} }},
		{name: "undeclared backend command", change: func(fields map[string]any, _ map[string]any) {
			delete(fields["contributes"].(map[string]any), "commands")
		}},
		{name: "duplicate source identity", change: func(fields map[string]any, source map[string]any) {
			fields["contributes"].(map[string]any)["dataSources"] = []any{source, map[string]any{"id": source["id"], "name": "Other", "dialect": "sqlite", "command": "Driver", "readOnly": true}}
		}},
		{name: "too many sources", change: func(fields map[string]any, _ map[string]any) {
			sources := make([]any, 0, 9)
			for i := 0; i < 9; i++ {
				sources = append(sources, map[string]any{"id": "db" + strconv.Itoa(i), "name": "Database", "dialect": "postgres", "command": "Driver", "readOnly": true})
			}
			fields["contributes"].(map[string]any)["dataSources"] = sources
		}},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				filename, _ := artifactDataSourceArchive(t, format, artifactDataSourceManifest(t, test.change))
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("accepted datasource without required authorization or identity")
				}
			})
		}
	}
}
