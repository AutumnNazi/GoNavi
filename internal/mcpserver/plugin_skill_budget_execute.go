package mcpserver

import (
	"context"

	"GoNavi-Wails/internal/ai/runharness"
)

// A retained executor is not a bypass around a later publication-budget change.
// The underlying skill executor separately fences actual generation and bytes.
type pluginSkillBudgetExecutor struct {
	catalog    *PluginSkillAugmentedCatalog
	descriptor runharness.ToolDescriptor
	next       runharness.ToolExecutor
}

func (e *pluginSkillBudgetExecutor) Execute(ctx context.Context, request runharness.ToolExecutionRequest) (runharness.ToolExecutionResult, error) {
	if e == nil || e.catalog == nil || e.next == nil {
		return failedAgentToolResult("skill_unavailable"), ErrAgentToolNotFound
	}
	if ctx == nil {
		return failedAgentToolResult("context_required"), runharness.ErrRootContextRequired
	}
	ctx, cancel := context.WithTimeout(ctx, pluginSkillReadTimeout)
	defer cancel()
	_, skills, err := e.catalog.snapshot(ctx)
	if err != nil {
		return failedAgentToolResult("skill_unavailable"), err
	}
	for _, descriptor := range skills {
		if descriptor.Name != e.descriptor.Name {
			continue
		}
		if !runharness.ToolDescriptorEqual(descriptor, e.descriptor) {
			return failedAgentToolResult("skill_contract_changed"), runharness.ErrToolDescriptorMismatch
		}
		return e.next.Execute(ctx, request)
	}
	return failedAgentToolResult("skill_unavailable"), ErrAgentToolNotFound
}
