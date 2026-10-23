package mcpserver

import (
	"context"
	"time"

	"GoNavi-Wails/internal/plugin"
)

// Agent startup may race an explicitly enabled package's handshake. Wait only
// for opted-in starting entries, never start them, and let the caller cancel.
// An exhausted handshake window omits unavailable plugin tools rather than
// taking built-in database/workspace tools offline.
func (c *PluginToolCatalog) waitForStarting(ctx context.Context, manager *plugin.Manager) ([]plugin.Status, error) {
	statuses := manager.List()
	if !hasStartingPluginTools(statuses) || c.startupWait <= 0 {
		return statuses, nil
	}
	timer := time.NewTimer(c.startupWait)
	defer timer.Stop()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
			return manager.List(), nil
		case <-ticker.C:
			if !manager.OwnsRuntime() {
				return []plugin.Status{}, nil
			}
			statuses = manager.List()
			if !hasStartingPluginTools(statuses) {
				return statuses, nil
			}
		}
	}
}

func hasStartingPluginTools(statuses []plugin.Status) bool {
	for _, status := range statuses {
		if !status.DesiredEnabled || status.State != plugin.StateStarting || !pluginHasPublicCommands(status.Manifest) {
			continue
		}
		for _, permission := range status.Manifest.Permissions {
			if permission == "ai.tools" {
				return true
			}
		}
	}
	return false
}
