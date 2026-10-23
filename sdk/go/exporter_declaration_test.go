package plugin

import "testing"

func TestValidateExporterMetadata(t *testing.T) {
	exporter := Exporter{ID: "ndjson", Name: "Typed NDJSON", Command: "render", Extension: "ndjson", ContentType: "application/x-ndjson"}
	if err := ValidateExporter(exporter); err != nil {
		t.Fatal(err)
	}
	exporter.Extension = ".ndjson"
	if err := ValidateExporter(exporter); err == nil {
		t.Fatal("dotted extension was accepted")
	}
	exporter.Extension = "ndjson"
	exporter.ContentType = "application/x-ndjson; charset=utf-8"
	if err := ValidateExporter(exporter); err == nil {
		t.Fatal("content type parameter was accepted")
	}
}
