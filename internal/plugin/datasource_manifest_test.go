package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func dataSourceManifest() Manifest {
	manifest := basicManifest("example.source")
	manifest.Permissions = []string{"data.sources"}
	manifest.Backend = &Backend{Default: &Entry{Executable: "backend"}}
	manifest.Contributes.Commands = []Command{{ID: "database", Title: "Database", Effect: "unknown"}}
	manifest.Contributes.DataSources = []DataSource{{ID: "fixture", Name: "Read-only fixture", Dialect: "sqlite", Command: "database", ReadOnly: true}}
	return manifest
}

func TestDataSourceManifestValidation(t *testing.T) {
	cases := []struct {
		name   string
		change func(*Manifest)
	}{
		{"missing permission", func(m *Manifest) { m.Permissions = nil }},
		{"different permission", func(m *Manifest) { m.Permissions = []string{"data.source"} }},
		{"permission case", func(m *Manifest) { m.Permissions = []string{"data.Sources"} }},
		{"missing backend", func(m *Manifest) { m.Backend = nil }},
		{"missing commands", func(m *Manifest) { m.Contributes.Commands = nil }},
		{"unknown command", func(m *Manifest) { m.Contributes.DataSources[0].Command = "missing" }},
		{"command case", func(m *Manifest) { m.Contributes.DataSources[0].Command = "Database" }},
		{"empty name", func(m *Manifest) { m.Contributes.DataSources[0].Name = "" }},
		{"blank name", func(m *Manifest) { m.Contributes.DataSources[0].Name = " \n" }},
		{"long name", func(m *Manifest) { m.Contributes.DataSources[0].Name = strings.Repeat("x", 257) }},
		{"name byte limit", func(m *Manifest) { m.Contributes.DataSources[0].Name = strings.Repeat("中", 86) }},
		{"nul name", func(m *Manifest) { m.Contributes.DataSources[0].Name = "name\x00" }},
		{"write effect", func(m *Manifest) { m.Contributes.Commands[0].Effect = "write" }},
		{"upper write effect", func(m *Manifest) { m.Contributes.Commands[0].Effect = "WRITE" }},
		{"other effect", func(m *Manifest) { m.Contributes.Commands[0].Effect = "sideeffect" }},
		{"unsupported dialect", func(m *Manifest) { m.Contributes.DataSources[0].Dialect = "mssql" }},
		{"uppercase id", func(m *Manifest) { m.Contributes.DataSources[0].ID = "Fixture" }},
		{"colon id", func(m *Manifest) { m.Contributes.DataSources[0].ID = "fixture:postgres" }},
		{"path id", func(m *Manifest) { m.Contributes.DataSources[0].ID = "../fixture" }},
		{"negative port", func(m *Manifest) { m.Contributes.DataSources[0].DefaultPort = -1 }},
		{"overflow port", func(m *Manifest) { m.Contributes.DataSources[0].DefaultPort = 65536 }},
		{"duplicate type", func(m *Manifest) {
			m.Contributes.DataSources = append(m.Contributes.DataSources, m.Contributes.DataSources[0])
		}},
		{"same id different dialect", func(m *Manifest) {
			second := m.Contributes.DataSources[0]
			second.Dialect = "mysql"
			m.Contributes.DataSources = append(m.Contributes.DataSources, second)
		}},
		{"too many", func(m *Manifest) {
			for i := 1; i <= maxDataSources; i++ {
				next := m.Contributes.DataSources[0]
				next.ID = fmt.Sprintf("source%d", i)
				m.Contributes.DataSources = append(m.Contributes.DataSources, next)
			}
		}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			manifest := dataSourceManifest()
			test.change(&manifest)
			if err := ValidateManifest(manifest); err == nil {
				t.Fatal("invalid datasource manifest accepted")
			}
		})
	}
}

func TestDataSourceManifestValidBoundsAndSeparateNamespaces(t *testing.T) {
	manifest := dataSourceManifest()
	manifest.Contributes.DataSources[0].ID = "database"
	manifest.Contributes.Panels = []Panel{{ID: "database", Title: "Separate panel", Body: UINode{Type: "text"}}}
	for i := 1; i < maxDataSources; i++ {
		source := manifest.Contributes.DataSources[0]
		source.ID = fmt.Sprintf("source%d", i)
		manifest.Contributes.DataSources = append(manifest.Contributes.DataSources, source)
	}
	manifest.Contributes.DataSources[0].Name = strings.Repeat("中", 85)
	for _, effect := range []string{"", "read", "unknown"} {
		manifest.Contributes.Commands[0].Effect = effect
		if err := ValidateManifest(manifest); err != nil {
			t.Fatalf("effect %q: %v", effect, err)
		}
	}
	for _, port := range []int{0, 1, 65535} {
		manifest.Contributes.DataSources[0].DefaultPort = port
		if err := ValidateManifest(manifest); err != nil {
			t.Fatalf("valid source port %d: %v", port, err)
		}
	}
	manifest.Contributes.Commands[0].ID = "Database.Command"
	for i := range manifest.Contributes.DataSources {
		manifest.Contributes.DataSources[i].Command = "Database.Command"
	}
	if err := ValidateManifest(manifest); err != nil {
		t.Fatalf("existing mixed-case command grammar changed: %v", err)
	}
}

func TestDataSourceManifestBackwardCompatibility(t *testing.T) {
	legacy := basicManifest("example.legacy")
	legacy.Contributes.Panels = []Panel{{ID: "panel", Title: "Panel", Body: UINode{Type: "text", Text: "Legacy"}}}
	content, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(content), "dataSources") {
		t.Fatal("absent sources changed legacy JSON")
	}
	if _, err = ParseManifest(content); err != nil {
		t.Fatalf("legacy manifest rejected: %v", err)
	}
	manifest := dataSourceManifest()
	content, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(content), "panels") {
		t.Fatal("nil panels should be omitted in a datasource-only declaration")
	}
	if _, err = ParseManifest(content); err != nil {
		t.Fatalf("datasource-only manifest without panels rejected: %v", err)
	}
}

func TestInspectDataSourcePackageDoesNotExecute(t *testing.T) {
	manifest := dataSourceManifest()
	directory := writePackage(t, manifest)
	if err := os.WriteFile(filepath.Join(directory, "backend"), []byte("not an executable; inspection is static"), 0600); err != nil {
		t.Fatal(err)
	}
	inspection, err := InspectPackage(context.Background(), directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(inspection.Manifest.Contributes.DataSources) != 1 || inspection.Manifest.Contributes.DataSources[0] != manifest.Contributes.DataSources[0] {
		t.Fatal("inspection lost datasource declaration")
	}
	for _, format := range []string{"zip", "tgz"} {
		t.Run(format, func(t *testing.T) {
			archive, err := InspectPackage(context.Background(), archivePackage(t, directory, format))
			if err != nil {
				t.Fatal(err)
			}
			if archive.Digest != inspection.Digest {
				t.Fatal("datasource package digest changed across transports")
			}
		})
	}
}
