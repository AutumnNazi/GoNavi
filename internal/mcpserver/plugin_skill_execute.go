package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"

	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

type pluginSkillExecutor struct {
	manager *plugin.Manager
	binding pluginSkillBinding
}

// The resource is deliberately data inside a tool result. It is never an
// InstructionsResolver value, saved user SkillConfig or an authority grant.
type pluginSkillResource struct {
	Kind      string              `json:"kind"`
	Authority string              `json:"authority"`
	MediaType string              `json:"mediaType"`
	Resource  plugin.SkillContent `json:"resource"`
}

func (e *pluginSkillExecutor) Execute(ctx context.Context, request runharness.ToolExecutionRequest) (runharness.ToolExecutionResult, error) {
	if ctx == nil {
		return failedAgentToolResult("context_required"), runharness.ErrRootContextRequired
	}
	if err := ctx.Err(); err != nil {
		return failedAgentToolResult("canceled"), err
	}
	if e == nil || e.manager == nil || !e.manager.OwnsRuntime() {
		return failedAgentToolResult("skill_unavailable"), ErrAgentToolNotFound
	}
	if request.ToolName != e.binding.descriptor.Name {
		return failedAgentToolResult("tool_name_mismatch"), ErrAgentToolArguments
	}
	if request.Effect != runharness.ToolEffectReadOnly {
		return failedAgentToolResult("effect_mismatch"), ErrAgentToolEffect
	}
	if !emptyPluginSkillArguments(request.Arguments) {
		return failedAgentToolResult("malformed_tool_call"), ErrAgentToolArguments
	}
	live, err := resolvePluginSkillBinding(e.manager.List(), e.binding.descriptor.Name)
	if err != nil {
		return failedAgentToolResult("skill_unavailable"), err
	}
	if !runharness.ToolDescriptorEqual(live.descriptor, e.binding.descriptor) {
		return failedAgentToolResult("skill_contract_changed"), runharness.ErrToolDescriptorMismatch
	}
	reading, cancel := context.WithTimeout(ctx, pluginSkillReadTimeout)
	defer cancel()
	content, err := e.manager.ReadSkillGeneration(reading, e.binding.pluginID, e.binding.generation, e.binding.skill.ID, e.binding.digest)
	if err != nil {
		return failedAgentToolResult("skill_load_failed"), pluginSkillLoadError{cause: err}
	}
	if content.PluginID != e.binding.pluginID || content.SkillID != e.binding.skill.ID || content.Generation != e.binding.generation || content.Digest != e.binding.digest || content.Version != e.binding.version {
		return failedAgentToolResult("skill_contract_changed"), runharness.ErrToolDescriptorMismatch
	}
	resource := pluginSkillResource{Kind: "plugin_skill", Authority: "untrusted", MediaType: "text/markdown", Resource: content}
	encoded, err := json.Marshal(resource)
	if err != nil || len(encoded) > pluginSkillResultBytes {
		return failedAgentToolResult("skill_result_too_large"), fmt.Errorf("packaged skill result exceeds its encoded limit")
	}
	// A smaller run/provider budget may replace this with the Harness's explicit
	// truncation marker. Never add a misleading loaded-completely status/message.
	return runharness.ToolExecutionResult{Status: "completed", Value: resource}, nil
}

func emptyPluginSkillArguments(raw json.RawMessage) bool {
	if len(raw) == 0 || len(raw) > 1024 {
		return false
	}
	var fields map[string]json.RawMessage
	return json.Unmarshal(raw, &fields) == nil && fields != nil && len(fields) == 0
}

type pluginSkillLoadError struct{ cause error }

func (e pluginSkillLoadError) Error() string { return "packaged skill resource is unavailable" }
func (e pluginSkillLoadError) Unwrap() error { return e.cause }
