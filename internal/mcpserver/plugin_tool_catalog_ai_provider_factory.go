package mcpserver

import (
	"GoNavi-Wails/internal/ai/provider"
	appcore "GoNavi-Wails/internal/app"
)

// NewPluginAIProviderFactoryForBackend borrows the backend's existing App owner.
// Construction and metadata discovery never initialize plugin execution. Other
// backends receive an unavailable factory and cannot fall back to another owner.
func NewPluginAIProviderFactoryForBackend(backend Backend) *provider.PluginFactory {
	application, ok := backend.(*AppBackend)
	if !ok || application == nil {
		return appcore.PluginAIProviderFactoryForIntegration(nil)
	}
	return appcore.PluginAIProviderFactoryForIntegration(application.app)
}
