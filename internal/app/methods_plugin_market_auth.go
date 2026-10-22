package app

import (
	"context"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/pluginmarket"
)

// PluginMarketLogin starts explicit browser authorization, not an authenticated session.
func (a *App) PluginMarketLogin() connection.QueryResult {
	return a.pluginMarketLoginContext(a.pluginContext())
}

func (a *App) pluginMarketLoginContext(ctx context.Context) connection.QueryResult {
	if !a.pluginManagementAllowed() {
		return a.pluginFailure("management_denied")
	}
	return a.marketCall(ctx, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return s.Login(ctx) })
}

// PluginMarketPollLogin stores an approved token in secretstore, never in frontend state.
func (a *App) PluginMarketPollLogin(deviceCode string) connection.QueryResult {
	return a.pluginMarketPollLoginContext(a.pluginContext(), deviceCode)
}

func (a *App) pluginMarketPollLoginContext(ctx context.Context, deviceCode string) connection.QueryResult {
	if !a.pluginManagementAllowed() {
		return a.pluginFailure("management_denied")
	}
	return a.marketCall(ctx, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return s.PollLogin(ctx, deviceCode) })
}

// PluginMarketLogout revokes the remote session and removes locally stored credentials.
func (a *App) PluginMarketLogout() connection.QueryResult {
	return a.pluginMarketLogoutContext(a.pluginContext())
}

func (a *App) pluginMarketLogoutContext(ctx context.Context) connection.QueryResult {
	if !a.pluginManagementAllowed() {
		return a.pluginFailure("management_denied")
	}
	return a.marketCall(ctx, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return nil, s.Logout(ctx) })
}
