package plugin

import (
	"encoding/json"
	"testing"
)

func TestExporterManifestRoundTrip(t *testing.T) {
	declaration := Exporter{ID: "ndjson", Name: "NDJSON", Command: "render", Extension: "ndjson", ContentType: "application/x-ndjson"}
	raw, err := json.Marshal(declaration)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != 5 {
		t.Fatal("exporter wire must have five explicit fields")
	}
	for _, name := range []string{"id", "name", "command", "extension", "contentType"} {
		if len(fields[name]) == 0 {
			t.Fatal("omitted exporter field", name)
		}
	}
	var decoded Exporter
	if err = json.Unmarshal(raw, &decoded); err != nil || decoded != declaration {
		t.Fatalf("roundtrip: %+v %v", decoded, err)
	}
	raw, err = json.Marshal(Contributions{Exporters: []Exporter{declaration}})
	if err != nil {
		t.Fatal(err)
	}
	var contributions Contributions
	if err = json.Unmarshal(raw, &contributions); err != nil || len(contributions.Exporters) != 1 {
		t.Fatal("contribution roundtrip", err)
	}
}
