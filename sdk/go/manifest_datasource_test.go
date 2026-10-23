package plugin

import (
	"encoding/json"
	"testing"
)

func TestManifestDataSourceWireShape(t *testing.T) {
	source := DataSource{ID: "fixture", Name: "Read-only database", Dialect: "sqlite", Command: "database", ReadOnly: true}
	manifest := Manifest{SchemaVersion: 1, APIVersion: APIVersion, ID: "example.database", Name: "Database", Version: "1.0.0", Permissions: []string{"data.sources"}, Backend: &Backend{Default: &Entry{Executable: "bin/database"}}, Contributes: &Contributions{Commands: []Command{{ID: "database", Title: "Database"}}, DataSources: []DataSource{source}}}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	var contributions map[string]json.RawMessage
	if err = json.Unmarshal(fields["contributes"], &contributions); err != nil {
		t.Fatal(err)
	}
	if _, exists := contributions["panels"]; exists {
		t.Fatal("nil panels must be omitted, not serialized as null")
	}
	var entries []map[string]json.RawMessage
	if err = json.Unmarshal(contributions["dataSources"], &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || len(entries[0]) != 5 || string(entries[0]["readOnly"]) != "true" {
		t.Fatalf("unexpected data source shape: %s", contributions["dataSources"])
	}
	if _, exists := entries[0]["defaultPort"]; exists {
		t.Fatal("zero default port must be omitted")
	}
	var decoded Manifest
	if err = json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Contributes == nil || len(decoded.Contributes.DataSources) != 1 || decoded.Contributes.DataSources[0] != source {
		t.Fatal("source did not survive JSON roundtrip")
	}
}

func TestManifestOptionalContributionsRemainAbsent(t *testing.T) {
	raw, err := json.Marshal(Contributions{})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "{}" {
		t.Fatalf("empty optional arrays must be absent: %s", raw)
	}
}

func TestDataSourceReadOnlyIsNeverOmitted(t *testing.T) {
	// The SDK does not silently repair invalid declarations; the host must reject false.
	raw, err := json.Marshal(DataSource{DefaultPort: 5432})
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if string(fields["readOnly"]) != "false" || string(fields["defaultPort"]) != "5432" {
		t.Fatalf("invalid declaration hidden by serialization: %s", raw)
	}
}
