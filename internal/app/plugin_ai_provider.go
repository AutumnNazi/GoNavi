package app

import (
	"context"
	"errors"

	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/plugin"
)

// PluginAIProviderFactoryForIntegration constructs an instance-owned factory.
// Its callbacks borrow metadata and the current owner; construction performs no IO.
// A package function keeps host lifecycle capabilities out of Wails and Web RPC.
func PluginAIProviderFactoryForIntegration(a *App) *provider.PluginFactory {
	return provider.NewPluginFactory(
		func(ctx context.Context) (provider.PluginProviderSnapshot, error) {
			return pluginAIProviderSnapshot(ctx, a)
		},
		func(ctx context.Context) (*plugin.Manager, error) {
			return PluginAIProviderManagerForIntegration(ctx, a)
		},
	)
}

// PluginAIProviderManagerForIntegration returns an existing local execution owner.
// Skills and providers share Web, safe-mode, root and owner lifecycle policy here;
// this helper does not grant ai.skills. The domain factory enforces ai.providers.
func PluginAIProviderManagerForIntegration(ctx context.Context, a *App) (*plugin.Manager, error) {
	return PluginSkillManagerForIntegration(ctx, a)
}

func pluginAIProviderSnapshot(ctx context.Context, a *App) (provider.PluginProviderSnapshot, error) {
	if ctx == nil {
		return provider.PluginProviderSnapshot{}, errors.New("plugin lifecycle unavailable")
	}
	if err := ctx.Err(); err != nil {
		return provider.PluginProviderSnapshot{}, err
	}
	if !pluginSkillManagementAllowed(a) {
		return provider.PluginProviderSnapshot{}, errors.New("plugin provider access denied")
	}
	statuses, err := a.pluginRuntimeStatuses(ctx)
	if err != nil {
		return provider.PluginProviderSnapshot{}, err
	}
	return provider.PluginProviderSnapshot{
		Statuses: statuses,
		Owned:    a.pluginRuntimeOwnsRuntime(),
		SafeMode: pluginEnvEnabled("GONAVI_DISABLE_PLUGINS"),
	}, ctx.Err()
}
