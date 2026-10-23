package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"GoNavi-Wails/internal/ai/runharness"
)

// PluginSkillCombinedToolLimit bounds skill additions, never existing tools.
const PluginSkillCombinedToolLimit = 128

// PluginSkillCatalogByteLimit bounds the combined serialized descriptor list.
const PluginSkillCatalogByteLimit = 256 << 10

// PluginSkillAugmentedCatalog adds optional skills within a fixed discovery
// budget. Ordinary catalogs retain their order, errors, effects and precedence.
type PluginSkillAugmentedCatalog struct{ ordinary, skills runharness.ToolCatalog }

// NewPluginSkillAugmentedCatalog adds no startup, body loading or global cache.
// If ordinary tools already exhaust either budget, no skills are appended.
func NewPluginSkillAugmentedCatalog(ordinary, skills runharness.ToolCatalog) *PluginSkillAugmentedCatalog {
	if ordinary == nil {
		ordinary = NewCompositeToolCatalog()
	}
	if skills == nil {
		skills = NewPluginSkillCatalog(nil)
	}
	return &PluginSkillAugmentedCatalog{ordinary: ordinary, skills: skills}
}

var _ runharness.ToolCatalog = (*PluginSkillAugmentedCatalog)(nil)
var _ runharness.ToolEffectResolver = (*PluginSkillAugmentedCatalog)(nil)

// List consults the ordinary catalog once, preserving its descriptors even when
// plugin discovery fails. Only caller cancellation can turn a skill failure fatal.
func (c *PluginSkillAugmentedCatalog) List(ctx context.Context) ([]runharness.ToolDescriptor, error) {
	ordinary, skills, err := c.snapshot(ctx)
	if err != nil {
		return nil, err
	}
	return append(ordinary, skills...), nil
}

func (c *PluginSkillAugmentedCatalog) snapshot(ctx context.Context) ([]runharness.ToolDescriptor, []runharness.ToolDescriptor, error) {
	if ctx == nil {
		return nil, nil, runharness.ErrRootContextRequired
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	ordinary, err := c.ordinary.List(ctx)
	if ctx.Err() != nil {
		return nil, nil, ctx.Err()
	}
	if err != nil {
		return nil, nil, err
	}
	ordinary = cloneAgentToolDescriptors(ordinary)
	encoded, err := json.Marshal(ordinary)
	if err != nil || len(ordinary) >= PluginSkillCombinedToolLimit || len(encoded) >= PluginSkillCatalogByteLimit {
		return ordinary, nil, nil
	}
	candidates, err := c.skills.List(ctx)
	if ctx.Err() != nil {
		return nil, nil, ctx.Err()
	}
	if err != nil {
		return ordinary, nil, nil
	}
	selected := boundedPluginSkillDescriptors(ordinary, candidates)
	return ordinary, selected, ctx.Err()
}

func boundedPluginSkillDescriptors(ordinary, candidates []runharness.ToolDescriptor) []runharness.ToolDescriptor {
	result := make([]runharness.ToolDescriptor, 0)
	seen := make(map[string]bool, len(ordinary)+len(candidates))
	for _, descriptor := range ordinary {
		seen[strings.TrimSpace(descriptor.Name)] = true
	}
	// The skill source orders canonical plugin ID / skill ID. Keep that order so
	// the cap does not vary with map iteration or prioritize a forged display name.
	for _, descriptor := range candidates {
		if len(result) >= PluginSkillToolLimit || len(ordinary)+len(result) >= PluginSkillCombinedToolLimit {
			break
		}
		if !strings.HasPrefix(descriptor.Name, pluginSkillPrefix) || descriptor.Effect != runharness.ToolEffectReadOnly || seen[descriptor.Name] {
			continue
		}
		combined := append(cloneAgentToolDescriptors(ordinary), result...)
		combined = append(combined, descriptor)
		encoded, err := json.Marshal(combined)
		if err != nil || len(encoded) > PluginSkillCatalogByteLimit {
			continue
		}
		seen[descriptor.Name] = true
		result = append(result, cloneAgentToolDescriptors([]runharness.ToolDescriptor{descriptor})[0])
	}
	return result
}

// Resolve preserves ordinary precedence, then enforces CURRENT publication
// budget membership. A guessed alias omitted from discovery cannot load a file.
func (c *PluginSkillAugmentedCatalog) Resolve(ctx context.Context, name string) (runharness.ToolDescriptor, runharness.ToolExecutor, error) {
	if ctx == nil {
		return runharness.ToolDescriptor{}, nil, runharness.ErrRootContextRequired
	}
	if err := ctx.Err(); err != nil {
		return runharness.ToolDescriptor{}, nil, err
	}
	descriptor, executor, err := c.ordinary.Resolve(ctx, name)
	if err == nil {
		return descriptor, executor, nil
	}
	if !errors.Is(err, ErrAgentToolNotFound) && !errors.Is(err, runharness.ErrToolNotFound) {
		return runharness.ToolDescriptor{}, nil, err
	}
	if !strings.HasPrefix(name, pluginSkillPrefix) {
		return runharness.ToolDescriptor{}, nil, ErrAgentToolNotFound
	}
	_, skills, err := c.snapshot(ctx)
	if err != nil {
		return runharness.ToolDescriptor{}, nil, err
	}
	for _, listed := range skills {
		if listed.Name != name {
			continue
		}
		live, execute, resolveErr := c.skills.Resolve(ctx, name)
		if resolveErr != nil {
			return runharness.ToolDescriptor{}, nil, resolveErr
		}
		if !runharness.ToolDescriptorEqual(listed, live) {
			return runharness.ToolDescriptor{}, nil, runharness.ErrToolDescriptorMismatch
		}
		frozen := cloneAgentToolDescriptors([]runharness.ToolDescriptor{live})[0]
		return live, &pluginSkillBudgetExecutor{catalog: c, descriptor: frozen, next: execute}, nil
	}
	return runharness.ToolDescriptor{}, nil, ErrAgentToolNotFound
}

// ResolveEffect delegates dynamic ordinary effects and fixes skill loads to read-only.
func (c *PluginSkillAugmentedCatalog) ResolveEffect(ctx context.Context, name string, args json.RawMessage) (runharness.ToolEffect, error) {
	if ctx == nil {
		return "", runharness.ErrRootContextRequired
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	descriptor, _, err := c.ordinary.Resolve(ctx, name)
	if err == nil {
		if resolver, ok := c.ordinary.(runharness.ToolEffectResolver); ok {
			return resolver.ResolveEffect(ctx, name, args)
		}
		return descriptor.Effect, nil
	}
	if !errors.Is(err, ErrAgentToolNotFound) && !errors.Is(err, runharness.ErrToolNotFound) {
		return "", err
	}
	descriptor, _, err = c.Resolve(ctx, name)
	if err != nil {
		return "", err
	}
	return descriptor.Effect, nil
}
