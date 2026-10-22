package app

import "GoNavi-Wails/internal/connection"

// PluginDataSources discovers installed declarations without activating plugins.
func (a *App) PluginDataSources() connection.QueryResult {
	statuses, err := a.pluginDataSourceStatuses(a.pluginDataSourceContext())
	if err != nil {
		return a.pluginFailure("runtime_unavailable")
	}
	return connection.QueryResult{Success: true, Data: PluginDataSourceCatalog{Items: pluginDataSourceViews(statuses, pluginEnvEnabled("GONAVI_DISABLE_PLUGINS"), a.pluginDataSourceOwnsRuntime())}}
}
