package app

import (
	"context"
	"errors"
	"strconv"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/plugin"
)

type pluginDatabaseFreshness interface {
	PluginGeneration() uint64
	IsCurrent() bool
}
type pluginDatabaseContextPinger interface{ PingContext(context.Context) error }

func pluginDataSourceCacheKey(config connection.ConnectionConfig, binding pluginDataSourceBinding, lane string) string {
	return getCacheKey(config) + "|plugin:" + binding.status.Digest + ":" + strconv.FormatUint(binding.status.Generation, 10) + lane
}

func (a *App) getPluginDataSource(ctx context.Context, config connection.ConnectionConfig, forcePing bool, lane string) (db.Database, error) {
	if ctx == nil {
		return nil, errors.New("plugin data source request context is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if _, _, _, valid := plugin.ParseDataSourceType(config.Type); !valid {
		return nil, errors.New("invalid plugin data source type")
	}
	resolved, err := a.resolveEffectiveConnectionConfig(config)
	if err != nil {
		return nil, err
	}
	binding, err := a.resolvePluginDataSource(ctx, resolved)
	if err != nil {
		a.evictPluginDataSourceCache(config.Type, 0)
		return nil, err
	}
	key := pluginDataSourceCacheKey(resolved, binding, lane)
	a.evictPluginDataSourceCache(resolved.Type, binding.status.Generation)
	a.mu.RLock()
	entry, exists := a.dbCache[key]
	shuttingDown := a.dbShuttingDown
	a.mu.RUnlock()
	if shuttingDown {
		return nil, errDatabaseConnectionShutdown
	}
	if exists && entry.inst != nil {
		if fresh, ok := entry.inst.(pluginDatabaseFreshness); ok && fresh.IsCurrent() {
			if forcePing {
				var pingErr error
				if pinger, ok := entry.inst.(pluginDatabaseContextPinger); ok {
					pingErr = pinger.PingContext(ctx)
				} else {
					pingErr = entry.inst.Ping()
				}
				if pingErr != nil {
					a.removePluginCachedInstance(key, entry.inst)
					return nil, pingErr
				}
			}
			if err := a.databaseConnectionReturnError(key, entry.inst); err != nil {
				return nil, err
			}
			return entry.inst, nil
		}
		a.removePluginCachedInstance(key, entry.inst)
	}
	// The leader owns a request context, so cancellation stops the physical
	// connection attempt. No plugin startup/query is silently replayed on error.
	result := a.dbConnectGroup.DoChan(key, func() (any, error) { return a.connectAndCachePluginDataSource(ctx, resolved, binding, key) })
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case completed := <-result:
		if completed.Err != nil {
			return nil, completed.Err
		}
		value, ok := completed.Val.(databaseConnectResult)
		if !ok || value.inst == nil {
			return nil, errors.New("plugin connection returned no database")
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if fresh, ok := value.inst.(pluginDatabaseFreshness); !ok || !fresh.IsCurrent() {
			a.removePluginCachedInstance(value.cacheKey, value.inst)
			return nil, plugin.ErrDisabled
		}
		if err := a.databaseConnectionReturnError(value.cacheKey, value.inst); err != nil {
			return nil, err
		}
		return value.inst, nil
	}
}

func (a *App) connectAndCachePluginDataSource(ctx context.Context, config connection.ConnectionConfig, binding pluginDataSourceBinding, key string) (databaseConnectResult, error) {
	flight, err := a.beginDatabaseConnectFlight(key, config)
	if err != nil {
		return databaseConnectResult{}, err
	}
	defer a.finishDatabaseConnectFlight(flight)
	a.mu.RLock()
	existing, exists := a.dbCache[key]
	a.mu.RUnlock()
	if exists && existing.inst != nil {
		return databaseConnectResult{inst: existing.inst, cacheKey: key}, nil
	}
	instance, err := a.connectPluginDataSource(ctx, config, binding)
	if err != nil {
		return databaseConnectResult{}, err
	}
	now := time.Now()
	policy := resolveConnectionKeepAlivePolicy(config)
	a.mu.Lock()
	publishErr := a.databaseConnectFlightErrorLocked(flight)
	if publishErr == nil {
		publishErr = ctx.Err()
	}
	if publishErr != nil {
		a.mu.Unlock()
		closePluginDatabase(instance)
		return databaseConnectResult{}, publishErr
	}
	if a.dbCache == nil {
		a.dbCache = make(map[string]cachedDatabase)
	}
	if previous, exists := a.dbCache[key]; exists && previous.inst != nil {
		a.mu.Unlock()
		closePluginDatabase(instance)
		return databaseConnectResult{inst: previous.inst, cacheKey: key}, nil
	}
	entry := cachedDatabase{inst: instance, lastPing: now, config: normalizeCacheKeyConfig(config)}
	a.dbCache[key] = policy.apply(entry, now)
	a.mu.Unlock()
	return databaseConnectResult{inst: instance, cacheKey: key}, nil
}

func (a *App) removePluginCachedInstance(key string, instance db.Database) {
	a.mu.Lock()
	entry, exists := a.dbCache[key]
	removed := exists && entry.inst == instance
	if removed {
		delete(a.dbCache, key)
	}
	a.mu.Unlock()
	if removed {
		closePluginDatabase(instance)
	}
}

func (a *App) evictPluginDataSourceCache(identity string, generation uint64) {
	if a == nil {
		return
	}
	a.mu.RLock()
	snapshot := make(map[string]db.Database)
	for key, entry := range a.dbCache {
		if isPluginDataSourceType(entry.config.Type) && (identity == "" || entry.config.Type == identity) {
			snapshot[key] = entry.inst
		}
	}
	a.mu.RUnlock()
	for key, instance := range snapshot {
		fresh, ok := instance.(pluginDatabaseFreshness)
		if generation == 0 || !ok || fresh.PluginGeneration() != generation || !fresh.IsCurrent() {
			a.removePluginCachedInstance(key, instance)
		}
	}
}

func closePluginDatabase(instance db.Database) {
	if instance == nil {
		return
	}
	if err := instance.Close(); err != nil {
		logger.Warnf("Plugin data source session cleanup did not complete")
	}
}
