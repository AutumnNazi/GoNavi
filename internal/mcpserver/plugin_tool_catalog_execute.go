package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"GoNavi-Wails/internal/ai/runharness"
	"GoNavi-Wails/internal/plugin"
)

type pluginToolExecutor struct {
	manager *plugin.Manager
	binding pluginToolBinding
}

var _ runharness.ToolExecutor = (*pluginToolExecutor)(nil)

func (e *pluginToolExecutor) Execute(ctx context.Context, request runharness.ToolExecutionRequest) (runharness.ToolExecutionResult, error) {
	if ctx == nil {
		return failedAgentToolResult("context_required"), runharness.ErrRootContextRequired
	}
	if err := ctx.Err(); err != nil {
		return failedAgentToolResult("canceled"), err
	}
	if e == nil || e.manager == nil || !e.manager.OwnsRuntime() {
		return failedAgentToolResult("plugin_unavailable"), ErrAgentToolNotFound
	}
	if strings.TrimSpace(request.ToolName) != e.binding.descriptor.Name {
		return failedAgentToolResult("tool_name_mismatch"), ErrAgentToolArguments
	}
	if request.Effect != runharness.ToolEffectSideEffectUnknown && request.Effect != runharness.ToolEffectSideEffect {
		return failedAgentToolResult("effect_mismatch"), ErrAgentToolEffect
	}
	if len(request.Arguments) > pluginToolMaxBytes || !json.Valid(request.Arguments) {
		return failedAgentToolResult("malformed_tool_call"), ErrAgentToolArguments
	}
	live, err := resolvePluginToolBinding(e.manager.List(), e.binding.descriptor.Name)
	if err != nil {
		return failedAgentToolResult("plugin_unavailable"), err
	}
	if live.digest != e.binding.digest || live.generation != e.binding.generation || !runharness.ToolDescriptorEqual(live.descriptor, e.binding.descriptor) {
		return failedAgentToolResult("plugin_contract_changed"), fmt.Errorf("%w: plugin generation or package changed", runharness.ErrToolDescriptorMismatch)
	}
	// The manager atomically checks this generation during admission and again
	// after completion. Never fall back to Invoke (the latest generation).
	value, err := e.manager.InvokeGeneration(ctx, e.binding.pluginID, e.binding.generation, e.binding.command, request.Arguments)
	if err != nil {
		// ErrDisabled can also mean a response was fenced AFTER the write happened.
		// No transport error proves rollback; preserve an unknown outcome rather
		// than allowing recovery to replay an unacknowledged native command.
		return runharness.ToolExecutionResult{Status: "unknown", ErrorCode: "plugin_outcome_unknown", UnknownOutcome: true}, pluginToolExecutionError{cause: err}
	}
	if len(value) == 0 {
		value = json.RawMessage("null")
	}
	if len(value) > pluginToolMaxBytes || !json.Valid(value) {
		return runharness.ToolExecutionResult{Status: "unknown", ErrorCode: "plugin_invalid_result", UnknownOutcome: true}, fmt.Errorf("invalid plugin result")
	}
	return runharness.ToolExecutionResult{Status: "completed", Value: append(json.RawMessage(nil), value...)}, nil
}

// Keep arbitrary plugin diagnostics out of the model/ledger error text while
// preserving cancellation identity for the Harness's unknown-outcome policy.
type pluginToolExecutionError struct{ cause error }

func (e pluginToolExecutionError) Error() string { return "plugin tool invocation failed" }
func (e pluginToolExecutionError) Unwrap() error { return e.cause }
