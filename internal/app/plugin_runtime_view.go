package app

import (
	"context"
	"errors"
	"path/filepath"

	"GoNavi-Wails/internal/plugin"
)

func (a *App) pluginRuntimeOwner() *App {
	if a != nil && a.metadataSession != nil {
		return a.metadataSession.owner
	}
	return a
}

func (a *App) pluginRuntimeOwnsRuntime() bool {
	owner := a.pluginRuntimeOwner()
	if owner == nil {
		return false
	}
	owner.plugins.mu.Lock()
	manager, closing := owner.plugins.manager, owner.plugins.closing
	owner.plugins.mu.Unlock()
	return !closing && manager != nil && manager.OwnsRuntime()
}

func (a *App) pluginRuntimeContext() context.Context {
	if a == nil {
		return nil
	}
	if a.metadataSession != nil {
		return a.metadataSession.ctx
	}
	return a.ctx
}

func (a *App) pluginRuntimeStatuses(ctx context.Context) ([]plugin.Status, error) {
	owner := a.pluginRuntimeOwner()
	if owner == nil || ctx == nil || owner.configDir == "" {
		return nil, errors.New("plugin lifecycle unavailable")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	owner.plugins.mu.Lock()
	manager, closing, root := owner.plugins.manager, owner.plugins.closing, owner.plugins.root
	owner.plugins.mu.Unlock()
	expected := filepath.Join(owner.configDir, "plugins")
	if closing {
		return nil, plugin.ErrClosed
	}
	if manager != nil {
		if root != expected {
			return nil, errors.New("plugin data root changed; restart required")
		}
		statuses := manager.List()
		return statuses, ctx.Err()
	}
	// This temporary metadata controller never acquires the execution lease and
	// is never published into App runtime state. List reads persisted metadata only.
	manager, err := plugin.NewManager(plugin.Options{Root: expected, HostVersion: CurrentVersion(), Disabled: pluginEnvEnabled("GONAVI_DISABLE_PLUGINS")})
	if err != nil {
		return nil, err
	}
	statuses := manager.List()
	if err := manager.Close(ctx); err != nil {
		return nil, err
	}
	return statuses, ctx.Err()
}
