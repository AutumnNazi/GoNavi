package app

import (
	"context"
	"time"

	"GoNavi-Wails/internal/connection"
)

const pluginSkillReadTimeout = 5 * time.Second

// PluginSkills lists immutable contribution metadata without starting plugins or
// loading documents. Disabled installations remain visible as unavailable.
func (a *App) PluginSkills() connection.QueryResult {
	return a.pluginSkillsContext(a.pluginRuntimeContext())
}

func (a *App) pluginSkillsContext(ctx context.Context) connection.QueryResult {
	if !pluginSkillManagementAllowed(a) {
		return a.pluginFailure("management_denied")
	}
	statuses, err := a.pluginRuntimeStatuses(ctx)
	if err != nil {
		return a.pluginFailure("runtime_unavailable")
	}
	items := pluginSkillViews(statuses, pluginEnvEnabled("GONAVI_DISABLE_PLUGINS"), a.pluginRuntimeOwnsRuntime())
	return connection.QueryResult{Success: true, Data: PluginSkillCatalog{Items: items}}
}

// PluginSkillRead explicitly previews one declared document at its exact runtime
// snapshot. Package path and content validation belong to the secure runtime reader.
func (a *App) PluginSkillRead(pluginID, skillID, digest string, generation uint64) connection.QueryResult {
	return a.pluginSkillReadContext(a.pluginRuntimeContext(), pluginID, skillID, digest, generation)
}

func (a *App) pluginSkillReadContext(ctx context.Context, pluginID, skillID, digest string, generation uint64) connection.QueryResult {
	if !pluginSkillManagementAllowed(a) {
		return a.pluginFailure("management_denied")
	}
	if !validPluginSkillRequest(pluginID, skillID, digest, generation) {
		return a.pluginFailure("invalid_request")
	}
	if ctx == nil {
		return a.pluginFailure("runtime_unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, pluginSkillReadTimeout)
	defer cancel()
	manager, err := PluginSkillManagerForIntegration(ctx, a)
	if err != nil {
		return a.pluginFailure("runtime_unavailable")
	}
	value, err := manager.ReadSkillGeneration(ctx, pluginID, generation, skillID, digest)
	if err != nil || ctx.Err() != nil {
		return a.pluginFailure("operation_failed")
	}
	return connection.QueryResult{Success: true, Data: value}
}
