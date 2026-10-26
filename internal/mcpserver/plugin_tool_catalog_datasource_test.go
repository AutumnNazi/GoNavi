package mcpserver

import (
	"errors"
	"testing"

	"GoNavi-Wails/internal/plugin"
)

func TestPluginToolCatalogExcludesReservedDataSourceCommands(t *testing.T) {
	status := pluginCatalogStatus()
	status.Manifest.Permissions = append(status.Manifest.Permissions, "data.sources")
	reserved := plugin.Command{ID: "database", Title: "Database", Effect: "read"}
	status.Manifest.Contributes.Commands = append(status.Manifest.Contributes.Commands, reserved)
	status.Manifest.Contributes.DataSources = []plugin.DataSource{{ID: "fixture", Name: "Fixture", Dialect: "sqlite", Command: reserved.ID, ReadOnly: true}}
	bindings, err := pluginToolBindings([]plugin.Status{status})
	if err != nil {
		t.Fatal(err)
	}
	if len(bindings) != 1 || bindings[0].command != "hello" {
		t.Fatalf("reserved command exposed or ordinary command lost: %+v", bindings)
	}
	reservedName := newPluginToolBinding(status, reserved).descriptor.Name
	if _, err := resolvePluginToolBinding([]plugin.Status{status}, reservedName); !errors.Is(err, ErrAgentToolNotFound) {
		t.Fatalf("reserved tool resolved directly: %v", err)
	}
	// Even a malformed pre-validation snapshot cannot grant generic driver access.
	status.Manifest.Contributes.DataSources[0].ReadOnly = false
	status.Manifest.Permissions = []string{"ai.tools"}
	bindings, err = pluginToolBindings([]plugin.Status{status})
	if err != nil || len(bindings) != 1 || bindings[0].command != "hello" {
		t.Fatalf("reservation depended on driver grant: %+v %v", bindings, err)
	}
}

func TestPluginToolCatalogDatasourceOnlyDoesNotWaitForHandshake(t *testing.T) {
	status := pluginCatalogStatus()
	status.Manifest.Contributes.DataSources = []plugin.DataSource{{ID: "fixture", Command: "hello", ReadOnly: true, Dialect: "sqlite"}}
	bindings, err := pluginToolBindings([]plugin.Status{status})
	if err != nil || len(bindings) != 0 {
		t.Fatalf("driver-only package exposed tools: %+v %v", bindings, err)
	}
	status.State = plugin.StateStarting
	if hasStartingPluginTools([]plugin.Status{status}) {
		t.Fatal("excluded driver blocked Agent catalog on handshake")
	}
	status.Manifest.Contributes.Commands = append(status.Manifest.Contributes.Commands, plugin.Command{ID: "ordinary", Title: "Ordinary"})
	if !hasStartingPluginTools([]plugin.Status{status}) {
		t.Fatal("ordinary command handshake no longer awaited")
	}
}

func TestPluginToolCatalogReservationsArePackageLocal(t *testing.T) {
	driver := pluginCatalogStatus()
	driver.Manifest.Contributes.DataSources = []plugin.DataSource{{ID: "fixture", Command: "hello", ReadOnly: true, Dialect: "sqlite"}}
	ordinary := pluginCatalogStatus()
	ordinary.Manifest.ID = "other.ordinary"
	bindings, err := pluginToolBindings([]plugin.Status{driver, ordinary})
	if err != nil {
		t.Fatal(err)
	}
	if len(bindings) != 1 || bindings[0].pluginID != ordinary.Manifest.ID {
		t.Fatalf("reservation leaked across packages: %+v", bindings)
	}
}
