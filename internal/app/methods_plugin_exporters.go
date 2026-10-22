package app

import (
	"context"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/plugin"
)

// PluginExporterView is static, bounded format metadata, not execution authority.
type PluginExporterView struct {
	Format      string       `json:"format"`
	PluginID    string       `json:"pluginId"`
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Extension   string       `json:"extension"`
	ContentType string       `json:"contentType"`
	Streaming   bool         `json:"streaming,omitempty"`
	Version     string       `json:"version"`
	Digest      string       `json:"digest"`
	Generation  uint64       `json:"generation"`
	Available   bool         `json:"available"`
	State       plugin.State `json:"state"`
	Reason      string       `json:"reason,omitempty"`
}

// PluginExporterCatalog is an array even when no exporters are installed.
type PluginExporterCatalog struct {
	Items     []PluginExporterView `json:"items"`
	Truncated bool                 `json:"truncated,omitempty"`
}

// PluginExporters discovers snapshot format declarations without execution.
func (a *App) PluginExporters() connection.QueryResult {
	return a.pluginExportersContext(a.pluginRuntimeContext())
}

func (a *App) pluginExportersContext(ctx context.Context) connection.QueryResult {
	if !pluginSkillManagementAllowed(a) {
		return a.pluginExportFailure("unavailable")
	}
	if ctx == nil || ctx.Err() != nil {
		return a.pluginExportFailure("unavailable")
	}
	statuses, err := a.pluginRuntimeStatuses(ctx)
	if err != nil {
		return a.pluginExportFailure("unavailable")
	}
	result := pluginExporterCatalog(statuses, a.pluginRuntimeOwnsRuntime(), pluginEnvEnabled("GONAVI_DISABLE_PLUGINS"))
	if err := ctx.Err(); err != nil {
		return a.pluginExportFailure("unavailable")
	}
	return connection.QueryResult{Success: true, Data: result}
}
