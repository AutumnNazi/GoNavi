package app

import (
	"context"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/pluginmarket"
)

// PluginMarketSourceLogin starts authorization for one registered endpoint.
func (a *App) PluginMarketSourceLogin(sourceID string) connection.QueryResult {
	if !a.pluginManagementAllowed() {
		return a.pluginFailure("management_denied")
	}
	return a.marketSourceCall(a.pluginContext(), sourceID, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return s.Login(ctx) })
}

// PluginMarketSourcePollLogin polls only the source that issued the device code.
func (a *App) PluginMarketSourcePollLogin(sourceID, deviceCode string) connection.QueryResult {
	if !a.pluginManagementAllowed() {
		return a.pluginFailure("management_denied")
	}
	return a.marketSourceCall(a.pluginContext(), sourceID, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return s.PollLogin(ctx, deviceCode) })
}

// PluginMarketSourceLogout clears only the chosen source session.
func (a *App) PluginMarketSourceLogout(sourceID string) connection.QueryResult {
	if !a.pluginManagementAllowed() {
		return a.pluginFailure("management_denied")
	}
	return a.marketSourceCall(a.pluginContext(), sourceID, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return nil, s.Logout(ctx) })
}

// PluginMarketSourceRate creates a rating under the chosen source account.
func (a *App) PluginMarketSourceRate(sourceID, id string, stars int, body, version string) connection.QueryResult {
	if !a.pluginManagementAllowed() {
		return a.pluginFailure("management_denied")
	}
	return a.marketSourceCall(a.pluginContext(), sourceID, func(ctx context.Context, s *pluginmarket.Service) (any, error) {
		return s.Rate(ctx, id, stars, body, version)
	})
}

// PluginMarketSourceDeleteRating removes only the chosen source account rating.
func (a *App) PluginMarketSourceDeleteRating(sourceID, id string) connection.QueryResult {
	if !a.pluginManagementAllowed() {
		return a.pluginFailure("management_denied")
	}
	return a.marketSourceCall(a.pluginContext(), sourceID, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return nil, s.DeleteRating(ctx, id) })
}

// PluginMarketSourceSubmit uploads an archive using the chosen source account.
func (a *App) PluginMarketSourceSubmit(sourceID, archivePath, repositoryURL string) connection.QueryResult {
	if !a.pluginManagementAllowed() {
		return a.pluginFailure("management_denied")
	}
	return a.marketSourceCall(a.pluginContext(), sourceID, func(ctx context.Context, s *pluginmarket.Service) (any, error) {
		return s.Submit(ctx, archivePath, repositoryURL)
	})
}
