package main

import (
	"encoding/json"
	"os"
	"testing"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func TestWritableExampleManifestAndCommand(t *testing.T) {
	raw, err := os.ReadFile("gonavi.plugin.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest plugin.Manifest
	if err = json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.ID != "sdk.examples.writable" || manifest.Contributes == nil || len(manifest.Contributes.DataSources) != 1 {
		t.Fatal("example data source manifest changed")
	}
	source := manifest.Contributes.DataSources[0]
	var command plugin.Command
	for _, item := range manifest.Contributes.Commands {
		if item.ID == source.Command {
			command = item
			break
		}
	}
	if err = plugin.ValidateDataSourceCommand(source, command); err != nil {
		t.Fatal(err)
	}
	if source.ReadOnly || source.Dialect != "sqlite" || command.Effect != "write" {
		t.Fatalf("declaration: %+v command: %+v", source, command)
	}
}
