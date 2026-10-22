package mcpserver

import (
	"context"

	appcore "GoNavi-Wails/internal/app"
	"GoNavi-Wails/internal/plugin"
)

// NewAppPluginSkillCatalog borrows a policy-checked, already-owned runtime.
func NewAppPluginSkillCatalog(provider func(context.Context) (*plugin.Manager, error)) *PluginSkillCatalog {
	return NewPluginSkillCatalog(provider)
}

// NewPluginSkillCatalogForBackend retains the App's safe-mode and Web denial.
// It never activates a runtime as a side effect of descriptor discovery.
func NewPluginSkillCatalogForBackend(backend Backend) *PluginSkillCatalog {
	application, ok := backend.(*AppBackend)
	if !ok || application == nil {
		return NewPluginSkillCatalog(nil)
	}
	return NewAppPluginSkillCatalog(func(ctx context.Context) (*plugin.Manager, error) {
		return appcore.PluginSkillManagerForIntegration(ctx, application.app)
	})
}
