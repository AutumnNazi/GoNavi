package mcpserver

import (
	"context"

	"GoNavi-Wails/internal/ai/runharness"
	appcore "GoNavi-Wails/internal/app"
	"GoNavi-Wails/internal/plugin"
)

// NewAppPluginToolCatalog is the desktop composition convenience. The supplied
// accessor must return an existing locally owned manager without starting one.
func NewAppPluginToolCatalog(providerGetter func(context.Context) (*plugin.Manager, error)) *PluginToolCatalog {
	return NewPluginToolCatalog(providerGetter)
}

// ActivatePluginToolsForBackend explicitly starts plugin execution for an Agent
// worker owner. Discovery and read-only/control callers must never call it.
// Other Backend adapters remain unaffected; activation failures are returned so
// the host can report them without taking built-in Agent tools offline.
func ActivatePluginToolsForBackend(ctx context.Context, backend Backend) error {
	if ctx == nil {
		return runharness.ErrRootContextRequired
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	application, ok := backend.(*AppBackend)
	if !ok || application == nil {
		return nil
	}
	return appcore.InitializePluginExecution(ctx, application.app)
}

// NewPluginToolCatalogForBackend borrows the App already owned by a real backend.
// Other Backend adapters keep their current behavior with no plugin descriptors.
func NewPluginToolCatalogForBackend(backend Backend) *PluginToolCatalog {
	application, ok := backend.(*AppBackend)
	if !ok || application == nil {
		return NewPluginToolCatalog(nil)
	}
	return NewAppPluginToolCatalog(func(ctx context.Context) (*plugin.Manager, error) {
		return appcore.PluginManagerForIntegration(ctx, application.app)
	})
}
