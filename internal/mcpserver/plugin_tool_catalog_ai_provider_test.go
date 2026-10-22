package mcpserver

import (
	"errors"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginToolCatalogExcludesAIAndDataSourceCommandUnion(t *testing.T) {
	for _, permissions := range [][]string{{"ai.tools"}, {"ai.tools", "ai.providers", "data.sources"}} {
		t.Run(permissions[len(permissions)-1], func(t *testing.T) {
			status := pluginCatalogStatus()
			status.Manifest.Permissions = permissions
			for _, id := range []string{"generate", "database", "shared"} {
				status.Manifest.Contributes.Commands = append(status.Manifest.Contributes.Commands, plugin.Command{ID: id, Title: id})
			}
			status.Manifest.Contributes.AIProviders = []plugin.AIProvider{{ID: "model", Command: "generate"}, {ID: "other", Command: "shared"}}
			status.Manifest.Contributes.DataSources = []plugin.DataSource{{ID: "db", Command: "database"}, {ID: "other", Command: "shared"}}
			bindings, err := pluginToolBindings([]plugin.Status{status})
			if err != nil || len(bindings) != 1 || bindings[0].command != "hello" {
				t.Fatalf("reserved union exposed or ordinary command lost: %+v %v", bindings, err)
			}
			for _, command := range status.Manifest.Contributes.Commands[1:] {
				name := newPluginToolBinding(status, command).descriptor.Name
				if _, err := resolvePluginToolBinding([]plugin.Status{status}, name); !errors.Is(err, ErrAgentToolNotFound) {
					t.Fatalf("reserved %s resolved directly: %v", command.ID, err)
				}
			}
		})
	}
}

func TestPluginToolCatalogAIOnlyDoesNotWaitForHandshake(t *testing.T) {
	status := pluginCatalogStatus()
	status.Manifest.Contributes.AIProviders = []plugin.AIProvider{{ID: "model", Command: "hello"}}
	bindings, err := pluginToolBindings([]plugin.Status{status})
	if err != nil || len(bindings) != 0 || pluginHasPublicCommands(status.Manifest) {
		t.Fatalf("provider-only package exposed ordinary tools: %+v %v", bindings, err)
	}
	status.State = plugin.StateStarting
	if hasStartingPluginTools([]plugin.Status{status}) {
		t.Fatal("provider-only handshake blocked the ordinary catalog")
	}
	status.Manifest.Contributes.Commands = append(status.Manifest.Contributes.Commands, plugin.Command{ID: "ordinary", Title: "Ordinary"})
	if !hasStartingPluginTools([]plugin.Status{status}) {
		t.Fatal("ordinary command no longer waits for its existing startup")
	}
}

func TestPluginToolCatalogAIReservationIsPackageLocal(t *testing.T) {
	reserved := pluginCatalogStatus()
	reserved.Manifest.Contributes.AIProviders = []plugin.AIProvider{{ID: "model", Command: "hello"}}
	ordinary := pluginCatalogStatus()
	ordinary.Manifest.ID = "other.provider"
	bindings, err := pluginToolBindings([]plugin.Status{reserved, ordinary})
	if err != nil || len(bindings) != 1 || bindings[0].pluginID != ordinary.Manifest.ID {
		t.Fatalf("AI reservation leaked across packages: %+v %v", bindings, err)
	}
}
