package market

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestValidatePackageStrictManifestJSON(t *testing.T) {
	cases := map[string]string{
		"no manifest":        "",
		"null":               "null",
		"array":              "[]",
		"syntax":             "{",
		"trailing document":  artifactTestManifest + " {}",
		"duplicate key":      strings.Replace(artifactTestManifest, `"schemaVersion":1`, `"schemaVersion":1,"schemaVersion":2`, 1),
		"escaped duplicate":  strings.Replace(artifactTestManifest, `"name":"Fixture"`, `"name":"Fixture","\u006eame":"Other"`, 1),
		"case alias":         strings.Replace(artifactTestManifest, `"apiVersion"`, `"APIVersion"`, 1),
		"official spoof":     strings.Replace(artifactTestManifest, `"permissions":[]`, `"official":true,"permissions":[]`, 1),
		"nested case alias":  strings.Replace(artifactTestManifest, `"executable"`, `"Executable"`, 1),
		"nested unknown":     strings.Replace(artifactTestManifest, `"executable":"bin/plugin"`, `"executable":"bin/plugin","shell":true`, 1),
		"missing permission": strings.Replace(artifactTestManifest, `"permissions":[],`, "", 1),
		"null permission":    strings.Replace(artifactTestManifest, `"permissions":[]`, `"permissions":null`, 1),
		"wrong permission":   strings.Replace(artifactTestManifest, `"permissions":[]`, `"permissions":"db.read"`, 1),
		"null name":          strings.Replace(artifactTestManifest, `"name":"Fixture"`, `"name":null`, 1),
		"null backend":       strings.Replace(artifactTestManifest, `"backend":{`, `"configSchema":null,"backend":{`, 1),
		"null optional":      strings.Replace(artifactTestManifest, `"author":"Test"`, `"author":null`, 1),
		"deep json":          strings.Replace(artifactTestManifest, `"permissions":[]`, `"permissions":[],"configSchema":{"x":`+strings.Repeat("[", 65)+"0"+strings.Repeat("]", 65)+"}", 1),
		"non utf8":           strings.Replace(artifactTestManifest, "Fixture", string([]byte{0xff}), 1),
	}
	for name, manifest := range cases {
		t.Run(name, func(t *testing.T) {
			entries := artifactTestEntries(manifest)
			if name == "no manifest" {
				entries = entries[1:]
			}
			filename := artifactTestWrite(t, ".zip", artifactTestZIP(t, entries))
			if _, err := ValidatePackage(context.Background(), filename); err == nil {
				t.Fatal("accepted invalid manifest json")
			}
		})
	}
}

func TestValidatePackageManifestSemantics(t *testing.T) {
	cases := []struct {
		name  string
		key   string
		value any
	}{
		{"schema", "schemaVersion", 2}, {"api", "apiVersion", 0},
		{"id case", "id", "Example.fixture"}, {"id segment", "id", "example..fixture"},
		{"id trailing hyphen", "id", "example.fixture-"}, {"missing publisher", "id", "fixture"},
		{"name blank", "name", " "}, {"description size", "description", strings.Repeat("x", 16385)},
		{"name byte", "name", strings.Repeat("界", 86)}, {"description byte", "description", strings.Repeat("文", 5462)},
		{"author byte", "author", strings.Repeat("界", 171)}, {"license byte", "license", strings.Repeat("界", 86)},
		{"minimum version", "minHostVersion", "v1.0.0"},
		{"permission duplicate", "permissions", []string{"db.read", "db.read"}},
		{"permission invalid", "permissions", []string{"*"}},
		{"dependency self", "requires", []any{map[string]any{"id": "example.fixture"}}},
		{"dependency version", "requires", []any{map[string]any{"id": "example.other", "minVersion": "1"}}},
		{"backend empty", "backend", map[string]any{}},
		{"missing entry", "backend", map[string]any{"default": map[string]any{"executable": "missing"}}},
		{"entry case", "backend", map[string]any{"default": map[string]any{"executable": "Bin/plugin"}}},
		{"entry directory", "backend", map[string]any{"default": map[string]any{"executable": "bin"}}},
		{"entry manifest", "backend", map[string]any{"default": map[string]any{"executable": artifactManifestName}}},
		{"entry path", "backend", map[string]any{"default": map[string]any{"executable": "../plugin"}}},
		{"entry runtime", "backend", map[string]any{"default": map[string]any{"executable": "bin/plugin", "runtime": "shell"}}},
		{"entry null args", "backend", map[string]any{"default": map[string]any{"executable": "bin/plugin", "args": nil}}},
		{"entry nul arg", "backend", map[string]any{"default": map[string]any{"executable": "bin/plugin", "args": []string{"\x00"}}}},
		{"platform", "backend", map[string]any{"platforms": map[string]any{"windows/invalid": map[string]any{"executable": "bin/plugin"}}}},
		{"window missing", "window", map[string]any{"entry": "window.exe"}},
		{"window dimensions", "window", map[string]any{"entry": "bin/plugin", "width": 8193}},
		{"window title byte", "window", map[string]any{"entry": "bin/plugin", "title": strings.Repeat("中", 86)}},
		{"window parent", "window", map[string]any{"entry": "../plugin"}},
		{"schema array", "configSchema", []any{}},
		{"undeclared button", "contributes", map[string]any{"panels": []any{map[string]any{"id": "panel", "title": "Panel", "body": map[string]any{"type": "button", "command": "missing"}}}}},
		{"unsupported ui", "contributes", map[string]any{"panels": []any{map[string]any{"id": "panel", "title": "Panel", "body": map[string]any{"type": "html"}}}}},
		{"effect", "contributes", map[string]any{"commands": []any{map[string]any{"id": "run", "title": "Run", "effect": "shell"}}}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			manifest := artifactTestChange(t, func(fields map[string]any) { fields[test.key] = test.value })
			filename := artifactTestWrite(t, ".zip", artifactTestZIP(t, artifactTestEntries(manifest)))
			if _, err := ValidatePackage(context.Background(), filename); err == nil {
				t.Fatal("accepted invalid manifest semantics")
			}
		})
	}
}

func TestValidatePackageAcceptsIdentityByteBounds(t *testing.T) {
	manifest := artifactTestChange(t, func(fields map[string]any) {
		fields["name"] = strings.Repeat("界", 85)
		fields["description"] = strings.Repeat("文", 5461)
		fields["author"] = strings.Repeat("界", 170)
		fields["license"] = strings.Repeat("界", 85)
	})
	filename := artifactTestWrite(t, ".zip", artifactTestZIP(t, artifactTestEntries(manifest)))
	if _, err := ValidatePackage(context.Background(), filename); err != nil {
		t.Fatal(err)
	}
}

func TestArtifactDependencyCountBound(t *testing.T) {
	requires := make([]any, 64)
	for i := range requires {
		requires[i] = map[string]any{"id": fmt.Sprintf("example.dep%d", i)}
	}
	decoded, err := decodeArtifactManifest([]byte(artifactTestChange(t, func(fields map[string]any) { fields["requires"] = requires })))
	if err != nil || validateArtifactMetadata(decoded) != nil {
		t.Fatal(err)
	}
	requires = append(requires, map[string]any{"id": "example.extra"})
	decoded, err = decodeArtifactManifest([]byte(artifactTestChange(t, func(fields map[string]any) { fields["requires"] = requires })))
	if err != nil || validateArtifactMetadata(decoded) == nil {
		t.Fatal("65 dependencies were accepted")
	}
}

func TestValidatePackageAcceptsWindowBounds(t *testing.T) {
	manifest := artifactTestChange(t, func(fields map[string]any) {
		fields["window"] = map[string]any{"entry": "bin/plugin", "title": strings.Repeat("中", 85), "width": 8192, "height": 0}
	})
	filename := artifactTestWrite(t, ".zip", artifactTestZIP(t, artifactTestEntries(manifest)))
	if _, err := ValidatePackage(context.Background(), filename); err != nil {
		t.Fatal(err)
	}
}

func TestArtifactSemanticVersions(t *testing.T) {
	cases := []struct {
		version string
		valid   bool
	}{
		{"0.0.0", true}, {"1.2.3", true}, {"1.2.3-rc.1+build.007", true},
		{"1.2.3-0", true}, {"1.2.3-01a", true}, {"1.2.3+001", true},
		{"1.2", false}, {"v1.2.3", false}, {"01.2.3", false}, {"1.2.3-01", false},
		{"1.2.3-alpha.00", false}, {"1.2.3-", false}, {"1.2.3+", false},
		{"1.2.3.4", false}, {"1.2.3\n", false}, {"1.2.3+bad space", false},
	}
	for _, test := range cases {
		t.Run(test.version, func(t *testing.T) {
			if got := validArtifactVersion(test.version); got != test.valid {
				t.Fatalf("valid = %v; want %v", got, test.valid)
			}
		})
	}
}

func TestArtifactManifestDeclarativeAndScriptEntries(t *testing.T) {
	manifest := artifactTestChange(t, func(fields map[string]any) {
		fields["backend"] = map[string]any{"default": map[string]any{"executable": "bin/plugin", "runtime": "python", "args": []string{"--name", "$(touch never)"}}}
		fields["window"] = map[string]any{"entry": "bin/plugin", "title": "Fixture", "width": 800, "height": 600}
		fields["requires"] = []any{map[string]any{"id": "example.other", "minVersion": "1.0.0", "optional": true}}
		fields["configSchema"] = map[string]any{"type": "object", "properties": map[string]any{"Case": map[string]any{}, "case": map[string]any{}}}
		fields["contributes"] = map[string]any{
			"commands": []any{map[string]any{"id": "run", "title": "Run", "effect": "read", "inputSchema": map[string]any{"type": "object"}}},
			"panels": []any{map[string]any{"id": "panel", "title": "Panel", "body": map[string]any{"type": "column", "children": []any{
				map[string]any{"type": "button", "command": "run", "arguments": nil},
				map[string]any{"type": "table", "columns": []any{map[string]any{"key": "value", "title": "Value"}}, "rows": []any{map[string]any{"value": "<script>inert data</script>"}}},
			}}}},
		}
	})
	filename := artifactTestWrite(t, ".zip", artifactTestZIP(t, artifactTestEntries(manifest)))
	validated, err := ValidatePackage(context.Background(), filename)
	if err != nil || len(validated.Platforms) != 1 || validated.Platforms[0] != "any" {
		t.Fatalf("valid declarative package: %+v, %v", validated, err)
	}
}
