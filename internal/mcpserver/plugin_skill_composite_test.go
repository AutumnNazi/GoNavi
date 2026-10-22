package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

type skillCompositeCatalogFake struct {
	descriptors  []runharness.ToolDescriptor
	executor     runharness.ToolExecutor
	listErr      error
	resolveErr   error
	listFunc     func(context.Context) ([]runharness.ToolDescriptor, error)
	resolveFunc  func(context.Context, string) (runharness.ToolDescriptor, runharness.ToolExecutor, error)
	effectFunc   func(context.Context, string, json.RawMessage) (runharness.ToolEffect, error)
	listCalls    int
	resolveCalls []string
	effectCalls  int
}

var _ runharness.ToolCatalog = (*skillCompositeCatalogFake)(nil)
var _ runharness.ToolEffectResolver = (*skillCompositeCatalogFake)(nil)

func (f *skillCompositeCatalogFake) List(ctx context.Context) ([]runharness.ToolDescriptor, error) {
	f.listCalls++
	if f.listFunc != nil {
		return f.listFunc(ctx)
	}
	return f.descriptors, f.listErr
}

func (f *skillCompositeCatalogFake) Resolve(ctx context.Context, name string) (runharness.ToolDescriptor, runharness.ToolExecutor, error) {
	f.resolveCalls = append(f.resolveCalls, name)
	if f.resolveFunc != nil {
		return f.resolveFunc(ctx, name)
	}
	if f.resolveErr != nil {
		return runharness.ToolDescriptor{}, nil, f.resolveErr
	}
	for _, descriptor := range f.descriptors {
		if descriptor.Name == name {
			return descriptor, f.executor, nil
		}
	}
	return runharness.ToolDescriptor{}, nil, ErrAgentToolNotFound
}

func (f *skillCompositeCatalogFake) ResolveEffect(ctx context.Context, name string, args json.RawMessage) (runharness.ToolEffect, error) {
	f.effectCalls++
	if f.effectFunc != nil {
		return f.effectFunc(ctx, name, args)
	}
	for _, descriptor := range f.descriptors {
		if descriptor.Name == name {
			return descriptor.Effect, nil
		}
	}
	return "", ErrAgentToolNotFound
}

type skillCompositeExecutorFake struct {
	calls  int
	result runharness.ToolExecutionResult
	err    error
}

var _ runharness.ToolExecutor = (*skillCompositeExecutorFake)(nil)

func (f *skillCompositeExecutorFake) Execute(context.Context, runharness.ToolExecutionRequest) (runharness.ToolExecutionResult, error) {
	f.calls++
	return f.result, f.err
}

func skillCompositeOrdinaryDescriptors(count int) []runharness.ToolDescriptor {
	descriptors := make([]runharness.ToolDescriptor, 0, count)
	for i := 0; i < count; i++ {
		descriptors = append(descriptors, runharness.ToolDescriptor{
			Name: fmt.Sprintf("ordinary_%03d", i), Description: "Ordinary tool metadata",
			InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
			Effect:      runharness.ToolEffectSideEffectUnknown, Capabilities: []string{"ordinary"},
		})
	}
	return descriptors
}

func skillCompositeSkillDescriptors(count int) []runharness.ToolDescriptor {
	status := fakeSkillStatus()
	descriptors := make([]runharness.ToolDescriptor, 0, count)
	for i := 0; i < count; i++ {
		skill := plugin.Skill{ID: fmt.Sprintf("skill-%03d", i), Name: fmt.Sprintf("Skill %03d", i), Description: "Metadata only", Entry: "SKILL.md"}
		descriptors = append(descriptors, newPluginSkillBinding(status, skill).descriptor)
	}
	return descriptors
}

func requireSkillCompositeDescriptors(t *testing.T, got, want []runharness.ToolDescriptor) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("descriptor count = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if !reflect.DeepEqual(got[i], want[i]) {
			t.Fatalf("descriptor %d (%q) changed", i, want[i].Name)
		}
	}
}

func skillCompositeEncodedSize(t *testing.T, descriptors []runharness.ToolDescriptor) int {
	t.Helper()
	encoded, err := json.Marshal(descriptors)
	if err != nil {
		t.Fatal(err)
	}
	return len(encoded)
}

func skillCompositePadCombined(t *testing.T, ordinary, skills []runharness.ToolDescriptor, size int) {
	t.Helper()
	combined := append(cloneAgentToolDescriptors(ordinary), skills...)
	padding := size - skillCompositeEncodedSize(t, combined)
	if len(ordinary) == 0 || padding < 0 {
		t.Fatal("invalid encoded-size fixture")
	}
	ordinary[0].Description += strings.Repeat("x", padding)
}

func TestPluginSkillAugmentedCatalogCountBudgets(t *testing.T) {
	if PluginSkillToolLimit != 32 || PluginSkillCombinedToolLimit != 128 || PluginSkillCatalogByteLimit != 256<<10 {
		t.Fatal("published plugin skill limits changed")
	}
	tests := []struct {
		name     string
		ordinary int
		want     int
	}{
		{name: "skill_only_limit_32", ordinary: 0, want: 32},
		{name: "all_32_combined_slots", ordinary: 96, want: 32},
		{name: "remaining_18_slots", ordinary: 110, want: 18},
		{name: "last_combined_slot", ordinary: 127, want: 1},
		{name: "ordinary_exactly_128", ordinary: 128, want: 0},
		{name: "ordinary_already_over_128", ordinary: 129, want: 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ordinary := &skillCompositeCatalogFake{descriptors: skillCompositeOrdinaryDescriptors(test.ordinary)}
			skills := &skillCompositeCatalogFake{descriptors: skillCompositeSkillDescriptors(40)}
			catalog := NewPluginSkillAugmentedCatalog(ordinary, skills)
			want := append(cloneAgentToolDescriptors(ordinary.descriptors), skills.descriptors[:test.want]...)
			for call := 1; call <= 2; call++ {
				got, err := catalog.List(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				requireSkillCompositeDescriptors(t, got, want)
				if ordinary.listCalls != call {
					t.Fatalf("ordinary List calls = %d, want %d", ordinary.listCalls, call)
				}
				wantSkillCalls := call
				if test.want == 0 {
					wantSkillCalls = 0
				}
				if skills.listCalls != wantSkillCalls {
					t.Fatalf("skill List calls = %d, want %d", skills.listCalls, wantSkillCalls)
				}
			}
		})
	}
}

func TestPluginSkillCatalogDeterministicSkillLimit32(t *testing.T) {
	statuses := make([]plugin.Status, 0, 3)
	for _, id := range []string{"test.z", "test.a", "test.m"} {
		status := fakeSkillStatus()
		status.Manifest.ID = id
		status.Manifest.Contributes.Skills = make([]plugin.Skill, 0, 16)
		for i := 15; i >= 0; i-- {
			status.Manifest.Contributes.Skills = append(status.Manifest.Contributes.Skills, plugin.Skill{
				ID: fmt.Sprintf("skill-%02d", i), Name: "Packaged guidance", Description: "Metadata", Entry: "SKILL.md",
			})
		}
		statuses = append(statuses, status)
	}
	bindings := pluginSkillBindings(statuses)
	if len(bindings) != 32 {
		t.Fatalf("bindings = %d, want 32", len(bindings))
	}
	for i, binding := range bindings {
		wantPlugin := "test.a"
		if i >= 16 {
			wantPlugin = "test.m"
		}
		if binding.pluginID != wantPlugin || binding.skill.ID != fmt.Sprintf("skill-%02d", i%16) {
			t.Fatalf("binding %d = %s/%s", i, binding.pluginID, binding.skill.ID)
		}
	}
	statuses[0], statuses[2] = statuses[2], statuses[0]
	if !reflect.DeepEqual(pluginSkillBindings(statuses), bindings) {
		t.Fatal("runtime status order changed selected skill membership")
	}
}

func TestPluginSkillAugmentedCatalogEncodedByteBoundary(t *testing.T) {
	for _, excess := range []int{0, 1} {
		t.Run(fmt.Sprintf("excess_%d", excess), func(t *testing.T) {
			ordinary := &skillCompositeCatalogFake{descriptors: skillCompositeOrdinaryDescriptors(1)}
			skills := &skillCompositeCatalogFake{descriptors: skillCompositeSkillDescriptors(1)}
			skills.descriptors[0].Description += strings.Repeat("<&\"\n", 32)
			skillCompositePadCombined(t, ordinary.descriptors, skills.descriptors, (256<<10)+excess)
			got, err := NewPluginSkillAugmentedCatalog(ordinary, skills).List(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			want := cloneAgentToolDescriptors(ordinary.descriptors)
			if excess == 0 {
				want = append(want, skills.descriptors[0])
				if size := skillCompositeEncodedSize(t, got); size != 256<<10 {
					t.Fatalf("encoded boundary = %d, want 256 KiB", size)
				}
			}
			requireSkillCompositeDescriptors(t, got, want)
			if ordinary.listCalls != 1 || skills.listCalls != 1 {
				t.Fatalf("List calls: ordinary=%d skills=%d", ordinary.listCalls, skills.listCalls)
			}
		})
	}
}

func TestPluginSkillAugmentedCatalogPreservesOverBudgetOrdinaryMetadata(t *testing.T) {
	tests := []struct {
		name   string
		mutate func([]runharness.ToolDescriptor)
	}{
		{name: "exactly_256_KiB", mutate: func(d []runharness.ToolDescriptor) { skillCompositePadCombined(t, d, nil, 256<<10) }},
		{name: "already_over_256_KiB", mutate: func(d []runharness.ToolDescriptor) { skillCompositePadCombined(t, d, nil, (256<<10)+1) }},
		{name: "escaped_bytes_exceed_raw_bytes", mutate: func(d []runharness.ToolDescriptor) { d[0].Description = strings.Repeat("<", 45000) }},
		{name: "ordinary_schema_cannot_encode", mutate: func(d []runharness.ToolDescriptor) { d[0].InputSchema = json.RawMessage(`{`) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ordinary := &skillCompositeCatalogFake{descriptors: skillCompositeOrdinaryDescriptors(2)}
			test.mutate(ordinary.descriptors)
			skills := &skillCompositeCatalogFake{descriptors: skillCompositeSkillDescriptors(1)}
			got, err := NewPluginSkillAugmentedCatalog(ordinary, skills).List(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			requireSkillCompositeDescriptors(t, got, ordinary.descriptors)
			if ordinary.listCalls != 1 || skills.listCalls != 0 {
				t.Fatalf("List calls: ordinary=%d skills=%d", ordinary.listCalls, skills.listCalls)
			}
		})
	}
}

func TestPluginSkillAugmentedCatalogSkipsOversizedSkillAndCopiesMetadata(t *testing.T) {
	ordinary := &skillCompositeCatalogFake{descriptors: skillCompositeOrdinaryDescriptors(2)}
	ordinary.descriptors[0], ordinary.descriptors[1] = ordinary.descriptors[1], ordinary.descriptors[0]
	skills := &skillCompositeCatalogFake{descriptors: skillCompositeSkillDescriptors(2)}
	skills.descriptors[0].Description = strings.Repeat("<", 45000)
	want := append(cloneAgentToolDescriptors(ordinary.descriptors), cloneAgentToolDescriptors(skills.descriptors[1:])...)
	catalog := NewPluginSkillAugmentedCatalog(ordinary, skills)
	got, err := catalog.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	requireSkillCompositeDescriptors(t, got, want)
	for i := range got {
		got[i].Description = "caller mutation"
		got[i].InputSchema[0] = 'x'
		got[i].Capabilities[0] = "caller mutation"
	}
	got, err = catalog.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	requireSkillCompositeDescriptors(t, got, want)
}

func TestPluginSkillAugmentedCatalogDoesNotDuplicateMCPDiscovery(t *testing.T) {
	discoveries := 0
	source := DynamicMCPSourceFuncs{ListFunc: func(context.Context) ([]DynamicMCPTool, error) {
		discoveries++
		return []DynamicMCPTool{{Descriptor: runharness.ToolDescriptor{Name: "mcp__fake__read", Effect: runharness.ToolEffectReadOnly}}}, nil
	}}
	ordinary := NewCompositeToolCatalog(NewAgentToolCatalogWithDynamicSource(nil, source), &skillCompositeCatalogFake{descriptors: skillCompositeOrdinaryDescriptors(1)})
	skills := &skillCompositeCatalogFake{descriptors: skillCompositeSkillDescriptors(1)}
	catalog := NewPluginSkillAugmentedCatalog(ordinary, skills)
	for call := 1; call <= 2; call++ {
		got, err := catalog.List(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		mcpCount := 0
		for _, descriptor := range got {
			if descriptor.Name == "mcp__fake__read" {
				mcpCount++
			}
		}
		if discoveries != call || mcpCount != 1 || skills.listCalls != call {
			t.Fatalf("call %d: discoveries=%d MCP descriptors=%d skill lists=%d", call, discoveries, mcpCount, skills.listCalls)
		}
	}
}

func TestPluginSkillAugmentedCatalogSkillFailuresKeepLiveParentBaseOnly(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{name: "unavailable", err: errors.New("skill source unavailable")},
		{name: "child_canceled", err: context.Canceled},
		{name: "child_deadline", err: context.DeadlineExceeded},
		{name: "wrapped_child_canceled", err: fmt.Errorf("skill discovery: %w", context.Canceled)},
		{name: "wrapped_child_deadline", err: fmt.Errorf("skill discovery: %w", context.DeadlineExceeded)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			executor := &skillCompositeExecutorFake{}
			ordinary := &skillCompositeCatalogFake{descriptors: skillCompositeOrdinaryDescriptors(1), executor: executor}
			skills := &skillCompositeCatalogFake{descriptors: skillCompositeSkillDescriptors(1), listErr: test.err}
			catalog := NewPluginSkillAugmentedCatalog(ordinary, skills)
			got, err := catalog.List(ctx)
			if err != nil || ctx.Err() != nil {
				t.Fatalf("optional skill failure: err=%v parent=%v", err, ctx.Err())
			}
			requireSkillCompositeDescriptors(t, got, ordinary.descriptors)
			if _, resolved, err := catalog.Resolve(ctx, ordinary.descriptors[0].Name); err != nil || resolved != executor {
				t.Fatalf("ordinary Resolve changed: %v", err)
			}
			if _, resolved, err := catalog.Resolve(ctx, skills.descriptors[0].Name); !errors.Is(err, ErrAgentToolNotFound) || resolved != nil {
				t.Fatalf("unpublished skill Resolve = %v, %v", resolved, err)
			}
			if len(skills.resolveCalls) != 0 || ordinary.listCalls != 2 || skills.listCalls != 2 {
				t.Fatalf("source calls: ordinary lists=%d skill lists=%d skill resolves=%d", ordinary.listCalls, skills.listCalls, len(skills.resolveCalls))
			}
		})
	}
}

func TestPluginSkillAugmentedCatalogChildTimeoutDoesNotCancelParent(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	ordinary := &skillCompositeCatalogFake{descriptors: skillCompositeOrdinaryDescriptors(1)}
	skills := &skillCompositeCatalogFake{listFunc: func(received context.Context) ([]runharness.ToolDescriptor, error) {
		if received != ctx {
			t.Fatal("skill source did not receive caller context")
		}
		child, stop := context.WithDeadline(received, time.Now().Add(-time.Second))
		defer stop()
		return nil, fmt.Errorf("child timeout: %w", child.Err())
	}}
	got, err := NewPluginSkillAugmentedCatalog(ordinary, skills).List(ctx)
	if err != nil || ctx.Err() != nil {
		t.Fatalf("child timeout escaped: err=%v parent=%v", err, ctx.Err())
	}
	requireSkillCompositeDescriptors(t, got, ordinary.descriptors)
}

func TestPluginSkillAugmentedCatalogPreservesOrdinaryErrors(t *testing.T) {
	for _, failure := range []error{errors.New("ordinary discovery failed"), context.Canceled, context.DeadlineExceeded} {
		t.Run(failure.Error(), func(t *testing.T) {
			ordinary := &skillCompositeCatalogFake{descriptors: skillCompositeOrdinaryDescriptors(1), listErr: failure, resolveErr: failure}
			skills := &skillCompositeCatalogFake{descriptors: skillCompositeSkillDescriptors(1)}
			catalog := NewPluginSkillAugmentedCatalog(ordinary, skills)
			if got, err := catalog.List(context.Background()); !errors.Is(err, failure) || got != nil {
				t.Fatalf("ordinary List = %v, %v", got, err)
			}
			if _, executor, err := catalog.Resolve(context.Background(), skills.descriptors[0].Name); !errors.Is(err, failure) || executor != nil {
				t.Fatalf("ordinary Resolve error changed: %v", err)
			}
			if _, err := catalog.ResolveEffect(context.Background(), skills.descriptors[0].Name, json.RawMessage(`{}`)); !errors.Is(err, failure) {
				t.Fatalf("ordinary ResolveEffect error changed: %v", err)
			}
			if skills.listCalls != 0 || len(skills.resolveCalls) != 0 {
				t.Fatal("ordinary failure reached optional skill source")
			}
		})
	}
}

func TestPluginSkillAugmentedCatalogParentCancellationIsFatal(t *testing.T) {
	for _, skillErr := range []error{errors.New("skill source stopped"), context.DeadlineExceeded, nil} {
		name := "successful_child_return"
		if skillErr != nil {
			name = skillErr.Error()
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			ordinary := &skillCompositeCatalogFake{descriptors: skillCompositeOrdinaryDescriptors(1)}
			skills := &skillCompositeCatalogFake{listFunc: func(context.Context) ([]runharness.ToolDescriptor, error) {
				cancel()
				return skillCompositeSkillDescriptors(1), skillErr
			}}
			got, err := NewPluginSkillAugmentedCatalog(ordinary, skills).List(ctx)
			if !errors.Is(err, context.Canceled) || got != nil {
				t.Fatalf("canceled parent List: count=%d err=%v", len(got), err)
			}
		})
	}
}

func TestPluginSkillAugmentedCatalogRequiresLiveContext(t *testing.T) {
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	expired, stop := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer stop()
	for _, test := range []struct {
		name string
		ctx  context.Context
		err  error
	}{
		{name: "missing", err: runharness.ErrRootContextRequired},
		{name: "canceled", ctx: canceled, err: context.Canceled},
		{name: "deadline", ctx: expired, err: context.DeadlineExceeded},
	} {
		t.Run(test.name, func(t *testing.T) {
			ordinary, skills := &skillCompositeCatalogFake{}, &skillCompositeCatalogFake{}
			catalog := NewPluginSkillAugmentedCatalog(ordinary, skills)
			if _, err := catalog.List(test.ctx); !errors.Is(err, test.err) {
				t.Fatalf("List error = %v", err)
			}
			if _, executor, err := catalog.Resolve(test.ctx, "skill__private"); !errors.Is(err, test.err) || executor != nil {
				t.Fatalf("Resolve error = %v", err)
			}
			if _, err := catalog.ResolveEffect(test.ctx, "skill__private", json.RawMessage(`{}`)); !errors.Is(err, test.err) {
				t.Fatalf("ResolveEffect error = %v", err)
			}
			if ordinary.listCalls+len(ordinary.resolveCalls)+skills.listCalls+len(skills.resolveCalls) != 0 {
				t.Fatal("invalid parent context reached catalog source")
			}
		})
	}
}

func TestPluginSkillAugmentedCatalogOrdinaryCollisionPrecedenceAndEffects(t *testing.T) {
	items := skillCompositeSkillDescriptors(2)
	ordinaryExecutor := &skillCompositeExecutorFake{result: runharness.ToolExecutionResult{Status: "completed", Value: "ordinary"}}
	ordinary := &skillCompositeCatalogFake{descriptors: skillCompositeOrdinaryDescriptors(1), executor: ordinaryExecutor}
	ordinary.descriptors[0].Name = items[0].Name
	ordinary.descriptors[0].Description = "Ordinary owner wins an alias collision"
	skills := &skillCompositeCatalogFake{descriptors: []runharness.ToolDescriptor{items[0], items[1], items[1]}, executor: &skillCompositeExecutorFake{}}
	catalog := NewPluginSkillAugmentedCatalog(ordinary, skills)
	got, err := catalog.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	requireSkillCompositeDescriptors(t, got, []runharness.ToolDescriptor{ordinary.descriptors[0], items[1]})
	descriptor, executor, err := catalog.Resolve(context.Background(), items[0].Name)
	if err != nil || executor != ordinaryExecutor || !reflect.DeepEqual(descriptor, ordinary.descriptors[0]) {
		t.Fatalf("ordinary collision owner changed: %v", err)
	}
	if len(skills.resolveCalls) != 0 || skills.listCalls != 1 || ordinary.listCalls != 1 {
		t.Fatal("ordinary Resolve rediscovered or resolved skills")
	}
	for _, want := range []runharness.ToolEffect{runharness.ToolEffectReadOnly, runharness.ToolEffectSideEffect} {
		args := json.RawMessage(`{"statement":"validated by ordinary owner"}`)
		ordinary.effectFunc = func(_ context.Context, name string, received json.RawMessage) (runharness.ToolEffect, error) {
			if name != items[0].Name || string(received) != string(args) {
				t.Fatal("dynamic effect arguments changed")
			}
			return want, nil
		}
		effect, err := catalog.ResolveEffect(context.Background(), items[0].Name, args)
		if err != nil || effect != want {
			t.Fatalf("ordinary dynamic effect = %q, %v; want %q", effect, err, want)
		}
	}
	if ordinary.effectCalls != 2 || skills.effectCalls != 0 {
		t.Fatal("effect resolution changed owners")
	}
}

func TestPluginSkillAugmentedCatalogRejectsOmittedAndPrivateAliases(t *testing.T) {
	tests := []struct {
		name     string
		ordinary int
		skills   int
		omitted  int
		byteFull bool
	}{
		{name: "skill_33", skills: 40, omitted: 32},
		{name: "combined_full", ordinary: 128, skills: 1},
		{name: "combined_last_slot_taken", ordinary: 127, skills: 2, omitted: 1},
		{name: "encoded_metadata_full", ordinary: 1, skills: 1, byteFull: true},
		{name: "private_alias_not_listed", ordinary: 1, skills: 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ordinary := &skillCompositeCatalogFake{descriptors: skillCompositeOrdinaryDescriptors(test.ordinary)}
			if test.byteFull {
				skillCompositePadCombined(t, ordinary.descriptors, nil, 256<<10)
			}
			allSkills := skillCompositeSkillDescriptors(test.skills + 1)
			hidden := allSkills[test.omitted]
			childExecutor := &skillCompositeExecutorFake{}
			skills := &skillCompositeCatalogFake{descriptors: allSkills[:test.skills], resolveFunc: func(context.Context, string) (runharness.ToolDescriptor, runharness.ToolExecutor, error) {
				return hidden, childExecutor, nil
			}}
			catalog := NewPluginSkillAugmentedCatalog(ordinary, skills)
			if _, executor, err := catalog.Resolve(context.Background(), hidden.Name); !errors.Is(err, ErrAgentToolNotFound) || executor != nil {
				t.Fatalf("omitted alias Resolve = %v, %v", executor, err)
			}
			if _, err := catalog.ResolveEffect(context.Background(), hidden.Name, json.RawMessage(`{}`)); !errors.Is(err, ErrAgentToolNotFound) {
				t.Fatalf("omitted alias effect = %v", err)
			}
			if len(skills.resolveCalls) != 0 || childExecutor.calls != 0 || ordinary.listCalls != 2 {
				t.Fatalf("omitted alias reached source: resolves=%d executes=%d ordinary lists=%d", len(skills.resolveCalls), childExecutor.calls, ordinary.listCalls)
			}
		})
	}
}

func TestPluginSkillAugmentedCatalogRejectsSourceDescriptorMismatch(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*runharness.ToolDescriptor)
	}{
		{name: "name", mutate: func(d *runharness.ToolDescriptor) { d.Name += "x" }},
		{name: "description", mutate: func(d *runharness.ToolDescriptor) { d.Description += " changed" }},
		{name: "schema", mutate: func(d *runharness.ToolDescriptor) {
			d.InputSchema = json.RawMessage(`{"type":"object","properties":{"extra":{"type":"string"}}}`)
		}},
		{name: "effect", mutate: func(d *runharness.ToolDescriptor) { d.Effect = runharness.ToolEffectSideEffect }},
		{name: "capability", mutate: func(d *runharness.ToolDescriptor) { d.Capabilities = append(d.Capabilities, "unexpected") }},
		{name: "timeout", mutate: func(d *runharness.ToolDescriptor) { d.DefaultTimeout++ }},
		{name: "result_limit", mutate: func(d *runharness.ToolDescriptor) { d.MaxResultBytes++ }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			listed := skillCompositeSkillDescriptors(1)[0]
			changed := cloneAgentToolDescriptors([]runharness.ToolDescriptor{listed})[0]
			test.mutate(&changed)
			childExecutor := &skillCompositeExecutorFake{}
			skills := &skillCompositeCatalogFake{descriptors: []runharness.ToolDescriptor{listed}, resolveFunc: func(context.Context, string) (runharness.ToolDescriptor, runharness.ToolExecutor, error) {
				return changed, childExecutor, nil
			}}
			catalog := NewPluginSkillAugmentedCatalog(&skillCompositeCatalogFake{}, skills)
			if _, executor, err := catalog.Resolve(context.Background(), listed.Name); !errors.Is(err, runharness.ErrToolDescriptorMismatch) || executor != nil {
				t.Fatalf("changed source descriptor Resolve = %v, %v", executor, err)
			}
			if len(skills.resolveCalls) != 1 || childExecutor.calls != 0 {
				t.Fatal("descriptor mismatch was not rejected before execution")
			}
		})
	}
}

func TestPluginSkillAugmentedCatalogAdmittedSkillExecutesReadOnly(t *testing.T) {
	ordinary := &skillCompositeCatalogFake{descriptors: skillCompositeOrdinaryDescriptors(1)}
	childExecutor := &skillCompositeExecutorFake{result: runharness.ToolExecutionResult{Status: "completed", Value: "explicit skill resource"}}
	skills := &skillCompositeCatalogFake{descriptors: skillCompositeSkillDescriptors(1), executor: childExecutor}
	catalog := NewPluginSkillAugmentedCatalog(ordinary, skills)
	name := skills.descriptors[0].Name
	descriptor, executor, err := catalog.Resolve(context.Background(), name)
	if err != nil || executor == nil || !runharness.ToolDescriptorEqual(descriptor, skills.descriptors[0]) {
		t.Fatalf("admitted skill Resolve = %+v, %v", descriptor, err)
	}
	effect, err := catalog.ResolveEffect(context.Background(), name, json.RawMessage(`{}`))
	if err != nil || effect != runharness.ToolEffectReadOnly || skills.effectCalls != 0 {
		t.Fatalf("skill effect = %q, %v; source effect calls=%d", effect, err, skills.effectCalls)
	}
	result, err := executor.Execute(context.Background(), runharness.ToolExecutionRequest{
		ToolName: name, Effect: effect, Arguments: json.RawMessage(`{}`),
	})
	if err != nil || result.Status != "completed" || result.Value != "explicit skill resource" || childExecutor.calls != 1 {
		t.Fatalf("admitted skill execution = %+v, %v; source calls=%d", result, err, childExecutor.calls)
	}
}

func TestPluginSkillAugmentedCatalogCachedExecutorRechecksCombinedBudget(t *testing.T) {
	ordinary := &skillCompositeCatalogFake{descriptors: skillCompositeOrdinaryDescriptors(1)}
	childExecutor := &skillCompositeExecutorFake{result: runharness.ToolExecutionResult{Status: "completed", Value: "skill body must not load"}}
	skills := &skillCompositeCatalogFake{descriptors: skillCompositeSkillDescriptors(1), executor: childExecutor}
	catalog := NewPluginSkillAugmentedCatalog(ordinary, skills)
	name := skills.descriptors[0].Name
	_, cached, err := catalog.Resolve(context.Background(), name)
	if err != nil || cached == nil {
		t.Fatalf("initial skill Resolve = %v", err)
	}
	if ordinary.listCalls != 1 || skills.listCalls != 1 || len(skills.resolveCalls) != 1 {
		t.Fatal("initial resolution did not take one current catalog snapshot")
	}
	ordinary.descriptors = skillCompositeOrdinaryDescriptors(129)
	result, err := cached.Execute(context.Background(), runharness.ToolExecutionRequest{
		ToolName: name, Effect: runharness.ToolEffectReadOnly, Arguments: json.RawMessage(`{}`),
	})
	if err == nil || result.Status != "failed" || result.Value != nil || result.UnknownOutcome {
		t.Fatalf("cached executor escaped current combined budget: result=%+v err=%v", result, err)
	}
	if ordinary.listCalls != 2 || skills.listCalls != 1 || len(skills.resolveCalls) != 1 || childExecutor.calls != 0 {
		t.Fatalf("budget rejection performed skill IO: ordinary lists=%d skill lists=%d resolves=%d executes=%d", ordinary.listCalls, skills.listCalls, len(skills.resolveCalls), childExecutor.calls)
	}
}
