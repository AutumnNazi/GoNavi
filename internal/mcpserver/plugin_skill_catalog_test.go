package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

func TestPluginSkillColdFileOnlyCatalog(t *testing.T) {
	// No wait-running fixture: publication must synchronize the owner's async
	// file-only activation without starting a runtime from ordinary discovery.
	for i := 0; i < 5; i++ {
		_, catalog, ctx := activeSkillCatalog(t, "# Guidance\nUse supplied facts only.\n")
		firstSkillName(t, ctx, catalog)
	}
}

func TestPluginSkillDiscoveryNeverStartsRuntimeOrLoadsBody(t *testing.T) {
	manager, status, ctx := installCatalogSkillPackage(t, "# Body sentinel not in metadata\n")
	catalog := NewPluginSkillCatalog(func(context.Context) (*plugin.Manager, error) { return manager, nil })
	if descriptors, err := catalog.List(ctx); err != nil || len(descriptors) != 0 {
		t.Fatalf("disabled discovery: %v %v", descriptors, err)
	}
	if manager.OwnsRuntime() {
		t.Fatal("catalog started a disabled runtime")
	}
	if _, err := manager.SetEnabled(ctx, status.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if descriptors, err := catalog.List(ctx); err != nil || len(descriptors) != 0 {
		t.Fatalf("nonowner discovery: %v %v", descriptors, err)
	}
	if manager.OwnsRuntime() {
		t.Fatal("catalog took runtime ownership")
	}
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	name := firstSkillName(t, ctx, catalog)
	asset, err := manager.AssetPath(status.Manifest.ID, "SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(asset); err != nil {
		t.Fatal(err)
	}
	descriptors, err := catalog.List(ctx)
	if err != nil || len(descriptors) != 1 || descriptors[0].Name != name {
		t.Fatalf("metadata listing read body: %v %v", descriptors, err)
	}
	if strings.Contains(descriptors[0].Description, "Body sentinel") {
		t.Fatal("body was silently advertised in descriptor")
	}
}

func TestPluginSkillExplicitLoadAndGenerationFence(t *testing.T) {
	const body = "# Skill resource\nUse read-only facts; do not grant tools.\n"
	manager, catalog, ctx := activeSkillCatalog(t, body)
	name := firstSkillName(t, ctx, catalog)
	frozen, err := runharness.FreezeToolCatalog(ctx, catalog)
	if err != nil {
		t.Fatal(err)
	}
	descriptor, executor, err := catalog.Resolve(ctx, name)
	if err != nil {
		t.Fatal(err)
	}
	descriptor.Capabilities[0] = "mutated"
	descriptor.InputSchema[0] = 'x'
	request := runharness.ToolExecutionRequest{ToolName: name, Effect: runharness.ToolEffectReadOnly, Arguments: json.RawMessage("{}")}
	loaded, err := executor.Execute(ctx, request)
	resource, ok := loaded.Value.(pluginSkillResource)
	if err != nil || !ok || resource.Kind != "plugin_skill" || resource.Authority != "untrusted" || resource.Resource.Content != body {
		t.Fatalf("explicit load: %+v %v", loaded, err)
	}
	if _, err := manager.SetEnabled(ctx, "test.skills", false); err != nil {
		t.Fatal(err)
	}
	if result, err := executor.Execute(ctx, request); err == nil || result.Value != nil {
		t.Fatalf("disabled load: %+v %v", result, err)
	}
	if _, err := manager.SetEnabled(ctx, "test.skills", true); err != nil {
		t.Fatal(err)
	}
	firstSkillName(t, ctx, catalog)
	live, _, err := catalog.Resolve(ctx, name)
	if err != nil || runharness.ToolDescriptorEqual(frozen.Descriptors[0], live) {
		t.Fatalf("reenable did not fence descriptor: %v", err)
	}
	if result, err := executor.Execute(ctx, request); !errors.Is(err, runharness.ErrToolDescriptorMismatch) || result.Value != nil {
		t.Fatalf("stale executor: %+v %v", result, err)
	}
}

func TestPluginSkillStrictArgumentsAndCancellation(t *testing.T) {
	_, catalog, ctx := activeSkillCatalog(t, "Resource body\n")
	name := firstSkillName(t, ctx, catalog)
	_, executor, err := catalog.Resolve(ctx, name)
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"", "null", "[]", "true", `{"path":"../secret"}`, `{"arguments":{}}`} {
		result, err := executor.Execute(ctx, runharness.ToolExecutionRequest{ToolName: name, Effect: runharness.ToolEffectReadOnly, Arguments: json.RawMessage(raw)})
		if !errors.Is(err, ErrAgentToolArguments) || result.Value != nil {
			t.Fatalf("arguments %q: %+v %v", raw, result, err)
		}
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if result, err := executor.Execute(canceled, runharness.ToolExecutionRequest{ToolName: name, Effect: runharness.ToolEffectReadOnly, Arguments: json.RawMessage("{}")}); !errors.Is(err, context.Canceled) || result.Value != nil {
		t.Fatalf("cancel: %+v %v", result, err)
	}
	if result, err := executor.Execute(ctx, runharness.ToolExecutionRequest{ToolName: name, Effect: runharness.ToolEffectSideEffectUnknown, Arguments: json.RawMessage("{}")}); !errors.Is(err, ErrAgentToolEffect) || result.Value != nil {
		t.Fatalf("effect mismatch: %+v %v", result, err)
	}
}

func TestPluginSkillMetadataIsReadonlyAndImmutable(t *testing.T) {
	status := fakeSkillStatus()
	binding := newPluginSkillBinding(status, status.Manifest.Contributes.Skills[0])
	if binding.descriptor.Effect != runharness.ToolEffectReadOnly || len(binding.descriptor.Name) > 64 || binding.descriptor.MaxResultBytes != 512<<10 {
		t.Fatalf("descriptor: %+v", binding.descriptor)
	}
	for _, mutate := range []func(*plugin.Status){func(s *plugin.Status) { s.Generation++ }, func(s *plugin.Status) { s.Digest = strings.Repeat("b", 64) }} {
		changed := status
		mutate(&changed)
		next := newPluginSkillBinding(changed, changed.Manifest.Contributes.Skills[0]).descriptor
		if next.Name != binding.descriptor.Name || runharness.ToolDescriptorEqual(next, binding.descriptor) {
			t.Fatal("snapshot replacement not fenced")
		}
	}
	status.Manifest.Permissions = []string{"ai.tools"}
	if len(pluginSkillBindings([]plugin.Status{status})) != 0 {
		t.Fatal("ai.tools silently granted ai.skills")
	}
}
