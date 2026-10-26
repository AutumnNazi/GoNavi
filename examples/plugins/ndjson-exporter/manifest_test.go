package main

import (
	"encoding/json"
	"os"
	"testing"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func TestExampleExporterStaysMetadataOnly(t *testing.T) {
	raw, err := os.ReadFile("gonavi.plugin.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest plugin.Manifest
	if err = json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Contributes == nil || len(manifest.Contributes.Exporters) != 1 {
		t.Fatal("example exporter changed")
	}
	exporter := manifest.Contributes.Exporters[0]
	if err = plugin.ValidateExporter(exporter); err != nil {
		t.Fatal(err)
	}
	if exporter.ID != "ndjson" || exporter.Command != "render" || exporter.Extension != "ndjson" {
		t.Fatalf("declaration: %+v", exporter)
	}
}
