package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

func pluginCatalogStatus() plugin.Status {
	return plugin.Status{Manifest: plugin.Manifest{
		ID: "example.hello", Permissions: []string{"ai.tools"},
		Contributes: plugin.Contributions{Commands: []plugin.Command{{ID: "hello", Title: "Hello", Description: "Describe hello", Effect: "read", InputSchema: json.RawMessage(`{"type":"object","properties":{"name":{"type":"string"}}}`)}}},
	}, Digest: strings.Repeat("a", 64), State: plugin.StateRunning, DesiredEnabled: true, Generation: 4}
}

func TestPluginToolCatalogExplicitOptIn(t *testing.T) {
	for _, tt := range []struct {
		name   string
		mutate func(*plugin.Status)
		want   bool
	}{
		{name: "running opted in", mutate: func(*plugin.Status) {}, want: true},
		{name: "no permission", mutate: func(s *plugin.Status) { s.Manifest.Permissions = nil }},
		{name: "case-sensitive permission", mutate: func(s *plugin.Status) { s.Manifest.Permissions = []string{"AI.Tools"} }},
		{name: "disabled intent", mutate: func(s *plugin.Status) { s.DesiredEnabled = false }},
		{name: "starting", mutate: func(s *plugin.Status) { s.State = plugin.StateStarting }},
		{name: "faulted", mutate: func(s *plugin.Status) { s.State = plugin.StateFaulted }},
		{name: "zero generation", mutate: func(s *plugin.Status) { s.Generation = 0 }},
		{name: "missing digest", mutate: func(s *plugin.Status) { s.Digest = "" }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			status := pluginCatalogStatus()
			tt.mutate(&status)
			bindings, err := pluginToolBindings([]plugin.Status{status})
			if err != nil {
				t.Fatal(err)
			}
			if (len(bindings) == 1) != tt.want {
				t.Fatalf("bindings=%d want exposed=%v", len(bindings), tt.want)
			}
		})
	}
}

func TestPluginToolDescriptorBindsGenerationDigestAndUnknownEffect(t *testing.T) {
	status := pluginCatalogStatus()
	command := status.Manifest.Contributes.Commands[0]
	binding := newPluginToolBinding(status, command)
	descriptor := binding.descriptor
	if descriptor.Effect != runharness.ToolEffectSideEffectUnknown {
		t.Fatal("manifest read claim bypassed approval")
	}
	if string(descriptor.InputSchema) != string(command.InputSchema) {
		t.Fatal("schema changed")
	}
	if len(descriptor.Name) > 64 || !strings.HasPrefix(descriptor.Name, pluginToolPrefix) {
		t.Fatalf("invalid provider alias: %q", descriptor.Name)
	}
	for _, r := range descriptor.Name {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_') {
			t.Fatalf("unsafe alias: %q", descriptor.Name)
		}
	}
	status.Generation++
	next := newPluginToolBinding(status, command).descriptor
	if next.Name != descriptor.Name || runharness.ToolDescriptorEqual(descriptor, next) {
		t.Fatal("same-schema generation swap escaped frozen descriptor comparison")
	}
	status.Generation--
	status.Digest = strings.Repeat("b", 64)
	updated := newPluginToolBinding(status, command).descriptor
	if runharness.ToolDescriptorEqual(descriptor, updated) {
		t.Fatal("package replacement escaped descriptor comparison")
	}
	descriptor.InputSchema[0] = 'x'
	if !json.Valid(command.InputSchema) {
		t.Fatal("descriptor exposed manifest backing memory")
	}
}

func TestPluginToolAliasesDoNotUseLossySanitization(t *testing.T) {
	status := pluginCatalogStatus()
	seen := make(map[string]bool)
	for _, id := range []string{"vendor.a-b", "vendor.a.b", "vendor-ab.c"} {
		for _, command := range []string{"read-name", "read.name", "read_name"} {
			status.Manifest.ID = id
			name := newPluginToolBinding(status, plugin.Command{ID: command, Title: command}).descriptor.Name
			if seen[name] {
				t.Fatalf("alias collision for %s/%s", id, command)
			}
			seen[name] = true
		}
	}
	status = pluginCatalogStatus()
	if _, err := pluginToolBindings([]plugin.Status{status, status}); !errors.Is(err, ErrAgentToolArguments) {
		t.Fatalf("duplicate identity: %v", err)
	}
}

func TestPluginToolCatalogLookupNeverClaimsRuntime(t *testing.T) {
	manager, err := plugin.NewManager(plugin.Options{Root: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := manager.Close(context.Background()); err != nil {
			t.Error(err)
		}
	})
	catalog := NewAppPluginToolCatalog(func(context.Context) (*plugin.Manager, error) { return manager, nil })
	if descriptors, err := catalog.List(context.Background()); err != nil || len(descriptors) != 0 {
		t.Fatalf("nonowner discovery: %v %v", descriptors, err)
	}
	if manager.OwnsRuntime() {
		t.Fatal("descriptor lookup started a runtime")
	}
	if descriptors, err := NewPluginToolCatalogForBackend(catalogBackend()).List(context.Background()); err != nil || len(descriptors) != 0 {
		t.Fatalf("non-App backend: %v %v", descriptors, err)
	}
}

func TestPluginToolStartingWaitRequiresOptIn(t *testing.T) {
	status := pluginCatalogStatus()
	if hasStartingPluginTools([]plugin.Status{status}) {
		t.Fatal("running tools triggered a startup wait")
	}
	status.State = plugin.StateStarting
	if !hasStartingPluginTools([]plugin.Status{status}) {
		t.Fatal("opted-in starting tool was ignored")
	}
	status.Manifest.Permissions = nil
	if hasStartingPluginTools([]plugin.Status{status}) {
		t.Fatal("unrelated plugin blocked Agent startup")
	}
}

func TestPluginToolCatalogUnavailableDoesNotBlockBuiltins(t *testing.T) {
	catalog := NewPluginToolCatalog(func(context.Context) (*plugin.Manager, error) { return nil, errors.New("unavailable") })
	composite := NewCompositeToolCatalog(NewAgentToolCatalog(catalogBackend()), catalog)
	descriptors, err := composite.List(context.Background())
	if err != nil || len(descriptors) == 0 {
		t.Fatalf("built-in list failed: %d %v", len(descriptors), err)
	}
	if _, _, err := catalog.Resolve(context.Background(), "plugin__missing"); !errors.Is(err, ErrAgentToolNotFound) {
		t.Fatalf("resolve: %v", err)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := catalog.List(cancelled); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled list: %v", err)
	}
	if _, err := catalog.List(nil); !errors.Is(err, runharness.ErrRootContextRequired) {
		t.Fatalf("nil context: %v", err)
	}
	if descriptors, err := NewPluginToolCatalog(nil).List(context.Background()); err != nil || len(descriptors) != 0 {
		t.Fatalf("nil accessor: %v %v", descriptors, err)
	}
}
