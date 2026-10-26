package app

import (
	"context"

	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/connection"
)

// PluginAIProviderCatalog exposes only domain metadata, with an array for Items.
type PluginAIProviderCatalog struct {
	Items []provider.PluginProviderView `json:"items"`
}

// PluginAIProviders lists static provider declarations without starting plugins,
// resolving credentials, reading package bodies or contacting a model.
func (a *App) PluginAIProviders() connection.QueryResult {
	return a.pluginAIProvidersContext(a.pluginRuntimeContext())
}

func (a *App) pluginAIProvidersContext(ctx context.Context) connection.QueryResult {
	if !pluginSkillManagementAllowed(a) {
		return a.pluginFailure("management_denied")
	}
	items, err := PluginAIProviderFactoryForIntegration(a).Catalog(ctx)
	if err != nil {
		return a.pluginFailure("runtime_unavailable")
	}
	if items == nil {
		items = []provider.PluginProviderView{}
	}
	return connection.QueryResult{Success: true, Data: PluginAIProviderCatalog{Items: items}}
}
