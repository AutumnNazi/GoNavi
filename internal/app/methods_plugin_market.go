package app

import (
	"context"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/pluginmarket"
)

// PluginMarketSettings returns configuration and session presence without secrets.
func (a *App) PluginMarketSettings() connection.QueryResult {
	return a.marketCall(a.pluginContext(), func(_ context.Context, s *pluginmarket.Service) (any, error) { return s.Settings() })
}

// PluginMarketConfigure changes a selected source without executing or downloading code.
func (a *App) PluginMarketConfigure(baseURL string) connection.QueryResult {
	return a.pluginMarketConfigureContext(a.pluginContext(), baseURL)
}

func (a *App) pluginMarketConfigureContext(ctx context.Context, baseURL string) connection.QueryResult {
	if !a.pluginManagementAllowed() {
		return a.pluginFailure("management_denied")
	}
	return a.marketCall(ctx, func(ctx context.Context, s *pluginmarket.Service) (any, error) {
		// Approval tickets bind the original receipt source, so keychain-backed
		// source changes must not monopolize local plugin lifecycle controls.
		return s.Configure(ctx, baseURL)
	})
}

// PluginMarketCatalog fetches a real bounded page or an explicitly stale cached page.
func (a *App) PluginMarketCatalog(query, sort, cursor string) connection.QueryResult {
	return a.pluginMarketCatalogContext(a.pluginContext(), query, sort, cursor)
}

func (a *App) pluginMarketCatalogContext(ctx context.Context, query, sort, cursor string) connection.QueryResult {
	return a.marketCall(ctx, func(ctx context.Context, s *pluginmarket.Service) (any, error) {
		return s.Catalog(ctx, query, sort, cursor)
	})
}

// PluginMarketDetail returns the reviewed manifest and artifact metadata.
func (a *App) PluginMarketDetail(id string) connection.QueryResult {
	return a.pluginMarketDetailContext(a.pluginContext(), id)
}

func (a *App) pluginMarketDetailContext(ctx context.Context, id string) connection.QueryResult {
	return a.marketCall(ctx, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return s.Detail(ctx, id) })
}

// PluginMarketRatings returns service-owned public ratings, never synthetic examples.
func (a *App) PluginMarketRatings(id string) connection.QueryResult {
	return a.pluginMarketRatingsContext(a.pluginContext(), id)
}

func (a *App) pluginMarketRatingsContext(ctx context.Context, id string) connection.QueryResult {
	return a.marketCall(ctx, func(ctx context.Context, s *pluginmarket.Service) (any, error) {
		ratings, err := s.Ratings(ctx, id)
		if ratings == nil {
			ratings = []pluginmarket.Rating{}
		}
		return ratings, err
	})
}

// PluginMarketRate creates or replaces this account's rating for the plugin.
func (a *App) PluginMarketRate(id string, stars int, body, version string) connection.QueryResult {
	return a.pluginMarketRateContext(a.pluginContext(), id, stars, body, version)
}

func (a *App) pluginMarketRateContext(ctx context.Context, id string, stars int, body, version string) connection.QueryResult {
	if !a.pluginManagementAllowed() {
		return a.pluginFailure("management_denied")
	}
	return a.marketCall(ctx, func(ctx context.Context, s *pluginmarket.Service) (any, error) {
		return s.Rate(ctx, id, stars, body, version)
	})
}

// PluginMarketDeleteRating removes only the current account's rating.
func (a *App) PluginMarketDeleteRating(id string) connection.QueryResult {
	return a.pluginMarketDeleteRatingContext(a.pluginContext(), id)
}

func (a *App) pluginMarketDeleteRatingContext(ctx context.Context, id string) connection.QueryResult {
	if !a.pluginManagementAllowed() {
		return a.pluginFailure("management_denied")
	}
	return a.marketCall(ctx, func(ctx context.Context, s *pluginmarket.Service) (any, error) { return nil, s.DeleteRating(ctx, id) })
}
