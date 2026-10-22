package plugin

import (
	"strings"
	"testing"
)

func TestExporterNameByteBounds(t *testing.T) {
	exporter := Exporter{ID: "ndjson", Name: strings.Repeat("中", 85), Command: "render", Extension: "ndjson", ContentType: "application/x-ndjson"}
	if err := ValidateExporter(exporter); err != nil {
		t.Fatal(err)
	}
	exporter.Name = strings.Repeat("中", 86)
	if ValidateExporter(exporter) == nil {
		t.Fatal("exporter name over 256 bytes was accepted")
	}
}
