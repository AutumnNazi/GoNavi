package plugin

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func exporterManifest() Manifest {
	m := basicManifest("example.exporter")
	m.Permissions = []string{"data.export"}
	m.Backend = &Backend{Default: &Entry{Executable: "plugin", Runtime: "native"}}
	m.Contributes.Commands = []Command{{ID: "render", Title: "Render"}, {ID: "ordinary", Title: "Ordinary"}}
	m.Contributes.Exporters = []Exporter{{ID: "ndjson", Name: "NDJSON", Command: "render", Extension: "ndjson", ContentType: "application/x-ndjson"}}
	return m
}

func TestExporterDeclarationsAreBoundedAndExact(t *testing.T) {
	cases := []struct {
		name   string
		change func(*Manifest)
	}{
		{"permission", func(m *Manifest) { m.Permissions = nil }},
		{"permission case", func(m *Manifest) { m.Permissions = []string{"Data.Export"} }},
		{"backend", func(m *Manifest) { m.Backend = nil }},
		{"undeclared command", func(m *Manifest) { m.Contributes.Exporters[0].Command = "missing" }},
		{"uppercase id", func(m *Manifest) { m.Contributes.Exporters[0].ID = "NDJSON" }},
		{"long id", func(m *Manifest) { m.Contributes.Exporters[0].ID = strings.Repeat("a", 65) }},
		{"duplicate", func(m *Manifest) {
			m.Contributes.Exporters = append(m.Contributes.Exporters, m.Contributes.Exporters[0])
		}},
		{"empty name", func(m *Manifest) { m.Contributes.Exporters[0].Name = " \n" }},
		{"nul name", func(m *Manifest) { m.Contributes.Exporters[0].Name = "bad\x00" }},
		{"invalid utf8", func(m *Manifest) { m.Contributes.Exporters[0].Name = string([]byte{0xff}) }},
		{"name bound", func(m *Manifest) { m.Contributes.Exporters[0].Name = strings.Repeat("x", 257) }},
		{"name byte limit", func(m *Manifest) { m.Contributes.Exporters[0].Name = strings.Repeat("中", 86) }},
		{"extension dot", func(m *Manifest) { m.Contributes.Exporters[0].Extension = ".csv" }},
		{"extension uppercase", func(m *Manifest) { m.Contributes.Exporters[0].Extension = "CSV" }},
		{"extension traversal", func(m *Manifest) { m.Contributes.Exporters[0].Extension = "../csv" }},
		{"extension bound", func(m *Manifest) { m.Contributes.Exporters[0].Extension = strings.Repeat("a", 17) }},
		{"content type prefix", func(m *Manifest) { m.Contributes.Exporters[0].ContentType = "image/png" }},
		{"content type params", func(m *Manifest) { m.Contributes.Exporters[0].ContentType = "text/csv;charset=utf-8" }},
		{"content type case", func(m *Manifest) { m.Contributes.Exporters[0].ContentType = "Text/csv" }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			m := exporterManifest()
			test.change(&m)
			if ValidateManifest(m) == nil {
				t.Fatal("invalid exporter accepted")
			}
		})
	}
	m := exporterManifest()
	m.Contributes.Commands[0].Effect = "write"
	for i := 1; i < 8; i++ {
		other := m.Contributes.Exporters[0]
		other.ID = fmt.Sprintf("exporter%d", i)
		m.Contributes.Exporters = append(m.Contributes.Exporters, other)
	}
	m.Contributes.Exporters[0].Name = strings.Repeat("中", 85)
	if err := ValidateManifest(m); err != nil {
		t.Fatal("valid shared command rejected", err)
	}
	other := m.Contributes.Exporters[0]
	other.ID = "extra"
	m.Contributes.Exporters = append(m.Contributes.Exporters, other)
	if ValidateManifest(m) == nil {
		t.Fatal("exporter count limit bypassed")
	}
}

func TestExporterStrictJSONFields(t *testing.T) {
	raw, err := json.Marshal(exporterManifest().Contributes.Exporters[0])
	if err != nil {
		t.Fatal(err)
	}
	valid := string(raw)
	fields := []string{"id", "name", "command", "extension", "contentType"}
	for _, field := range fields {
		t.Run(field, func(t *testing.T) {
			var object map[string]json.RawMessage
			if err := json.Unmarshal(raw, &object); err != nil {
				t.Fatal(err)
			}
			delete(object, field)
			missing, err := json.Marshal(object)
			if err != nil {
				t.Fatal(err)
			}
			values := []string{string(missing), strings.Replace(valid, `"`+field+`":`, `"`+field+`":null,"`+field+`":`, 1), strings.Replace(valid, `"`+field+`":`, `"`+strings.ToUpper(field[:1])+field[1:]+`":`, 1)}
			for _, value := range values {
				var exporter Exporter
				if json.Unmarshal([]byte(value), &exporter) == nil {
					t.Fatal("missing/duplicate/alias field accepted")
				}
			}
		})
	}
	for _, value := range []string{`null`, `[]`, strings.Replace(valid, `"extension":"ndjson"`, `"extension":null`, 1), strings.Replace(valid, `"extension":"ndjson"`, `"extension":"ndjson","\u0065xtension":"csv"`, 1), strings.TrimSuffix(valid, "}") + `,"extra":true}`} {
		var exporter Exporter
		if json.Unmarshal([]byte(value), &exporter) == nil {
			t.Fatal("ambiguous exporter accepted")
		}
	}
	var exporter Exporter
	if err := json.Unmarshal([]byte(strings.Replace(valid, "contentType", `content\u0054ype`, 1)), &exporter); err != nil {
		t.Fatal("single canonical escaped key rejected", err)
	}
}

func TestExporterIdentityAndProtectedNamespace(t *testing.T) {
	m := exporterManifest()
	value := ExporterType(m.ID, m.Contributes.Exporters[0])
	id, exporter, ok := ParseExporterType(value)
	if !ok || id != m.ID || exporter != "ndjson" {
		t.Fatal("identity roundtrip")
	}
	for _, raw := range []string{"plugin", " Plugin ", "PLUGIN:example.exporter:ndjson", " plugin:example.exporter:ndjson", "plugin :example.exporter:ndjson", "plugin\t:example.exporter:ndjson", "plugin:example.exporter:ndjson:csv", "plugin:example.exporter:ndjson "} {
		if _, _, ok := ParseExporterType(raw); ok {
			t.Fatalf("repaired malformed identity %q", raw)
		}
		if !IsExporterNamespace(raw) {
			t.Fatalf("namespace escaped guard %q", raw)
		}
	}
	if IsExporterNamespace("xlsx") || ExporterType("bad", Exporter{ID: "ndjson"}) != "" {
		t.Fatal("invalid identity handling")
	}
}

func TestExporterRequestEnvelopeBindsSelectedIdentity(t *testing.T) {
	valid := `{"protocolVersion":1,"exporterId":"ndjson","columns":["value"],"rows":[]}`
	for _, raw := range []string{strings.Replace(valid, "ndjson", "other", 1), strings.Replace(valid, `"exporterId"`, `"ExporterId"`, 1), strings.Replace(valid, `"rows":[]`, `"rows":null`, 1), strings.Replace(valid, `"rows":[]`, `"rows":{}`, 1), strings.Replace(valid, `"rows":[]`, `"rows":[],"rows":[]`, 1), valid + "{}", strings.Repeat(" ", maxExporterJSONBytes) + valid} {
		if validateExporterArguments([]byte(raw), "ndjson") == nil {
			t.Fatal("invalid request accepted")
		}
	}
	if err := validateExporterArguments([]byte(valid), "ndjson"); err != nil {
		t.Fatal(err)
	}
}

func FuzzParseExporterType(f *testing.F) {
	for _, seed := range []string{"plugin:example.exporter:ndjson", "PLUGIN:x:y", "plugin", "plugin:example.exporter:ndjson:extra"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, value string) {
		id, exporter, ok := ParseExporterType(value)
		if ok && ExporterType(id, Exporter{ID: exporter}) != value {
			t.Fatal("normalization occurred")
		}
		if !ok && (id != "" || exporter != "") {
			t.Fatal("invalid parse leaked identity")
		}
	})
}

func TestStreamingExporterDeclarationSurvivesManifestJSON(t *testing.T) {
	m := exporterManifest()
	m.Contributes.Exporters[0].Streaming = true
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	var decoded Manifest
	if err = json.Unmarshal(raw, &decoded); err != nil || len(decoded.Contributes.Exporters) != 1 || !decoded.Contributes.Exporters[0].Streaming {
		t.Fatalf("streaming declaration did not round-trip: %v %#v", err, decoded.Contributes.Exporters)
	}
	bad := strings.Replace(string(raw), `"streaming":true`, `"streaming":"true"`, 1)
	if err = json.Unmarshal([]byte(bad), &decoded); err == nil {
		t.Fatal("non-boolean streaming declaration was accepted")
	}
}

func TestStreamingExporterArgumentsRequireChunkIdentity(t *testing.T) {
	row := `[{"kind":"string","value":"x"}]`
	valid := fmt.Sprintf(`{"protocolVersion":2,"exporterId":"ndjson","columns":["a"],"chunkIndex":0,"chunkCount":1,"rows":[%s]}`, row)
	if err := validateExporterArguments(json.RawMessage(valid), "ndjson"); err != nil {
		t.Fatal(err)
	}
	for _, broken := range []string{
		fmt.Sprintf(`{"protocolVersion":2,"exporterId":"ndjson","columns":["a"],"rows":[%s]}`, row),
		fmt.Sprintf(`{"protocolVersion":2,"exporterId":"ndjson","columns":["a"],"chunkIndex":1,"chunkCount":1,"rows":[%s]}`, row),
		fmt.Sprintf(`{"protocolVersion":2,"exporterId":"ndjson","columns":["a"],"chunkIndex":0,"chunkCount":0,"rows":[%s]}`, row),
		fmt.Sprintf(`{"protocolVersion":1,"exporterId":"ndjson","columns":["a"],"chunkIndex":0,"chunkCount":1,"rows":[%s]}`, row),
	} {
		if err := validateExporterArguments(json.RawMessage(broken), "ndjson"); err == nil {
			t.Fatalf("invalid streaming arguments accepted: %s", broken)
		}
	}
}
