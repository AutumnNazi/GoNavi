package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/Syngnat/GoNavi/sdk/go"
)

func TestExampleCommandsMatchSDK(t *testing.T) {
	for _, name := range []string{"hello", "ndjson-exporter", "read-only-database", "ai-provider", "skills"} {
		t.Run(name, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join("..", name, "gonavi.plugin.json"))
			if err != nil {
				t.Fatal(err)
			}
			var manifest plugin.Manifest
			if err = json.Unmarshal(raw, &manifest); err != nil {
				t.Fatal(err)
			}
			if err = plugin.ValidatePermissionNotes(manifest); err != nil {
				t.Fatal(err)
			}
			commands := map[string]plugin.Command{}
			for _, command := range manifest.Contributes.Commands {
				if err = plugin.ValidateCommand(command); err != nil {
					t.Fatal(command.ID, err)
				}
				commands[command.ID] = command
			}
			root := filepath.Join("..", name)
			for _, skill := range manifest.Contributes.Skills {
				if err = plugin.ValidateSkillMetadata(skill); err != nil {
					t.Fatal(skill.ID, err)
				}
				if err = plugin.ValidateSkillResources(skill); err != nil {
					t.Fatal(skill.ID, err)
				}
				checkExampleSkillBody(t, root, skill.Entry)
				for _, resource := range skill.Resources {
					checkExampleSkillBody(t, root, resource)
				}
			}
			if name != "skills" && len(commands) == 0 {
				t.Fatal("example has no command")
			}
			for _, source := range manifest.Contributes.DataSources {
				command, ok := commands[source.Command]
				if !ok {
					t.Fatal("data source command is not declared")
				}
				if err = plugin.ValidateDataSourceCommand(source, command); err != nil {
					t.Fatal(source.ID, err)
				}
			}
			for _, exporter := range manifest.Contributes.Exporters {
				if _, ok := commands[exporter.Command]; !ok {
					t.Fatal("exporter command is not declared")
				}
				if err = plugin.ValidateExporter(exporter); err != nil {
					t.Fatal(exporter.ID, err)
				}
			}
			for _, provider := range manifest.Contributes.AIProviders {
				if _, ok := commands[provider.Command]; !ok {
					t.Fatal("provider command is not declared")
				}
				if err = plugin.ValidateAIProvider(provider); err != nil {
					t.Fatal(provider.ID, err)
				}
			}
			switch name {
			case "read-only-database":
				if len(manifest.Contributes.DataSources) == 0 {
					t.Fatal("read-only example has no data source")
				}
			case "ndjson-exporter":
				if len(manifest.Contributes.Exporters) == 0 {
					t.Fatal("exporter example has no exporter")
				}
			case "ai-provider":
				if len(manifest.Contributes.AIProviders) == 0 {
					t.Fatal("provider example has no provider")
				}
			case "skills":
				if len(manifest.Contributes.Skills) == 0 || len(commands) != 0 {
					t.Fatal("skill example must stay static")
				}
			}
		})
	}
}

func checkExampleSkillBody(t *testing.T, root, rel string) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatal(err)
	}
	if err = plugin.ValidateSkillDocument(raw); err != nil {
		t.Fatalf("%s: %v", rel, err)
	}
}
