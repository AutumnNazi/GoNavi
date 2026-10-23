package app

import (
	"context"
	"errors"

	"GoNavi-Wails/internal/plugin"
)

// PluginManagerForIntegration returns only an already-started, locally owned runtime.
// Descriptor discovery must never activate code or advertise another process's tools.
// A package function keeps this capability out of the reflective Wails surface.
func PluginManagerForIntegration(ctx context.Context, a *App) (*plugin.Manager, error) {
	if ctx == nil || a == nil {
		return nil, errors.New("plugin lifecycle unavailable")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	a.plugins.mu.Lock()
	manager, closing := a.plugins.manager, a.plugins.closing
	a.plugins.mu.Unlock()
	if closing || manager == nil || !manager.OwnsRuntime() {
		return nil, errors.New("local plugin runtime unavailable")
	}
	return manager, nil
}

// InitializePluginExecution explicitly activates enabled plugins for an execution owner.
// Read-only headless inspection and control commands must not call this function.
func InitializePluginExecution(ctx context.Context, a *App) error {
	_, err := a.pluginManager(ctx)
	return err
}
