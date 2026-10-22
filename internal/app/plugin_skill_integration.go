package app

import (
	"context"
	"errors"
	"path/filepath"

	"GoNavi-Wails/internal/plugin"
)

// PluginSkillManagerForIntegration applies skill access policy before returning an
// existing execution owner. A package function keeps this out of reflective bridges.
// Discovery and explicit reads must never initialize or start the plugin runtime.
func PluginSkillManagerForIntegration(ctx context.Context, a *App) (*plugin.Manager, error) {
	if ctx == nil {
		return nil, errors.New("plugin lifecycle unavailable")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !pluginSkillManagementAllowed(a) {
		return nil, errors.New("plugin skill access denied")
	}
	if pluginEnvEnabled("GONAVI_DISABLE_PLUGINS") {
		return nil, plugin.ErrDisabled
	}
	owner := a.pluginRuntimeOwner()
	owner.plugins.mu.Lock()
	root := owner.plugins.root
	owner.plugins.mu.Unlock()
	if owner.configDir == "" || root != filepath.Join(owner.configDir, "plugins") {
		return nil, errors.New("plugin data root changed; restart required")
	}
	return PluginManagerForIntegration(ctx, owner)
}

func pluginSkillManagementAllowed(a *App) bool {
	return a.pluginManagementAllowed() && a.pluginRuntimeOwner().pluginManagementAllowed()
}
