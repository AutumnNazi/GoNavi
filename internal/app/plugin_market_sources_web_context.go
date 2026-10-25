package app

import (
	"context"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/pluginmarket"
)

var marketSourceContextMethodNames = []string{"PluginMarketSourceSearch", "PluginMarketSources", "PluginMarketSaveSources", "PluginMarketSourceSettings", "PluginMarketSourceCatalog", "PluginMarketSourceDetail", "PluginMarketSourceRatings", "PluginMarketSourceLogin", "PluginMarketSourcePollLogin", "PluginMarketSourceLogout", "PluginMarketSourceRate", "PluginMarketSourceDeleteRating", "PluginMarketSourceSubmit", "PluginMarketVersions", "PluginMarketSourceVersions"}

func (a *App) marketSourceAction(ctx context.Context, id string, call func(context.Context, *pluginmarket.Service) (any, error)) connection.QueryResult {
	if !a.pluginManagementAllowed() {
		return a.pluginFailure("management_denied")
	}
	return a.marketSourceCall(ctx, id, call)
}

func withMarketSourceContextHandlers(a *App, handlers map[string]any) map[string]any {
	handlers["PluginMarketSourceSearch"] = a.pluginMarketSourceSearchContext
	handlers["PluginMarketSources"] = func(ctx context.Context) connection.QueryResult {
		return a.marketCall(ctx, func(_ context.Context, s *pluginmarket.Service) (any, error) { return s.Sources(), nil })
	}
	handlers["PluginMarketSaveSources"] = a.pluginMarketSaveSourcesContext
	handlers["PluginMarketSourceSettings"] = func(ctx context.Context, id string) connection.QueryResult {
		return a.marketSourceCall(ctx, id, func(_ context.Context, s *pluginmarket.Service) (any, error) { return s.Settings() })
	}
	handlers["PluginMarketSourceCatalog"] = func(ctx context.Context, id, q, order, cursor string) connection.QueryResult {
		return a.marketSourceCall(ctx, id, func(ctx context.Context, s *pluginmarket.Service) (any, error) {
			return s.Catalog(ctx, q, order, cursor)
		})
	}
	handlers["PluginMarketSourceDetail"] = func(ctx context.Context, sourceID, id string) connection.QueryResult {
		return a.marketSourceCall(ctx, sourceID, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return s.Detail(ctx, id) })
	}
	handlers["PluginMarketSourceRatings"] = func(ctx context.Context, sourceID, id string) connection.QueryResult {
		return a.marketSourceCall(ctx, sourceID, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return s.Ratings(ctx, id) })
	}
	handlers["PluginMarketSourceLogin"] = func(ctx context.Context, id string) connection.QueryResult {
		return a.marketSourceAction(ctx, id, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return s.Login(ctx) })
	}
	handlers["PluginMarketSourcePollLogin"] = func(ctx context.Context, id, code string) connection.QueryResult {
		return a.marketSourceAction(ctx, id, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return s.PollLogin(ctx, code) })
	}
	handlers["PluginMarketSourceLogout"] = func(ctx context.Context, id string) connection.QueryResult {
		return a.marketSourceAction(ctx, id, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return nil, s.Logout(ctx) })
	}
	handlers["PluginMarketSourceRate"] = func(ctx context.Context, sourceID, id string, stars int, body, version string) connection.QueryResult {
		return a.marketSourceAction(ctx, sourceID, func(ctx context.Context, s *pluginmarket.Service) (any, error) {
			return s.Rate(ctx, id, stars, body, version)
		})
	}
	handlers["PluginMarketSourceDeleteRating"] = func(ctx context.Context, sourceID, id string) connection.QueryResult {
		return a.marketSourceAction(ctx, sourceID, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return nil, s.DeleteRating(ctx, id) })
	}
	handlers["PluginMarketSourceSubmit"] = func(ctx context.Context, id, path, repository string) connection.QueryResult {
		return a.marketSourceAction(ctx, id, func(ctx context.Context, s *pluginmarket.Service) (any, error) {
			return s.Submit(ctx, path, repository)
		})
	}
	return withMarketVersionContextHandlers(a, handlers)
}
