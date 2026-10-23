package app

import (
	"context"
	"path"
	"strings"

	"GoNavi-Wails/internal/connection"
)

// PluginSkillResourceRead explicitly reads one declared markdown companion.
// It does not execute the file or add it to an agent prompt.
func (a *App) PluginSkillResourceRead(pluginID, skillID, digest, resource string, generation uint64) connection.QueryResult {
	return a.pluginSkillResourceReadContext(a.pluginRuntimeContext(), pluginID, skillID, digest, resource, generation)
}

func (a *App) pluginSkillResourceReadContext(ctx context.Context, pluginID, skillID, digest, resource string, generation uint64) connection.QueryResult {
	if !pluginSkillManagementAllowed(a) {
		return a.pluginFailure("management_denied")
	}
	if !validPluginSkillRequest(pluginID, skillID, digest, generation) || !validPluginSkillResource(resource) {
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
	value, err := manager.ReadSkillResourceGeneration(ctx, pluginID, generation, skillID, digest, resource)
	if err != nil || ctx.Err() != nil {
		return a.pluginFailure("operation_failed")
	}
	return connection.QueryResult{Success: true, Data: value}
}

func validPluginSkillResource(resource string) bool {
	if resource == "" || len(resource) > 256 || strings.Contains(resource, "..") || strings.Contains(resource, "\\") || strings.ContainsRune(resource, 0) {
		return false
	}
	if path.IsAbs(resource) || path.Clean(resource) != resource || !strings.HasSuffix(resource, ".md") || strings.HasSuffix(resource, "SKILL.md") {
		return false
	}
	return true
}
