package app

import (
	"context"
	"errors"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/plugin"
)

type pluginDataSourceBinding struct {
	manager *plugin.Manager
	status  plugin.Status
	source  plugin.DataSource
}

func findPluginDataSource(statuses []plugin.Status, identity string) (plugin.Status, plugin.DataSource, error) {
	id, sourceID, dialect, valid := plugin.ParseDataSourceType(identity)
	if !valid {
		return plugin.Status{}, plugin.DataSource{}, errors.New("invalid plugin data source type")
	}
	for _, status := range statuses {
		if status.Manifest.ID != id {
			continue
		}
		if !pluginDataSourcePermitted(status.Manifest) {
			return plugin.Status{}, plugin.DataSource{}, plugin.ErrDisabled
		}
		for _, source := range status.Manifest.Contributes.DataSources {
			if source.ID == sourceID && source.Dialect == dialect && plugin.DataSourceType(id, source) == identity {
				return status, source, nil
			}
		}
	}
	return plugin.Status{}, plugin.DataSource{}, plugin.ErrNotFound
}

func rejectPluginTransport(config connection.ConnectionConfig) error {
	if config.UseSSH || config.UseProxy || config.UseHTTPTunnel || config.UseSSL || config.SSLCAPath != "" || config.SSLCertPath != "" || config.SSLKeyPath != "" || (config.SSLMode != "" && config.SSLMode != "disable") {
		return errors.New("plugin data sources do not support host SSH, proxy, HTTP tunnel or TLS settings")
	}
	if config.Driver != "" || config.DSN != "" || config.URI != "" || len(config.Hosts) > 0 || (config.DriverVariant != "" && config.DriverVariant != "auto") || (config.Topology != "" && config.Topology != "single") || config.ReplicaSet != "" || config.JVM.JMX.Enabled || config.JVM.Endpoint.Enabled || config.JVM.Agent.Enabled || config.JVM.Diagnostic.Enabled {
		return errors.New("plugin data sources require a single direct connection configuration")
	}
	return nil
}

func (a *App) resolvePluginDataSource(ctx context.Context, config connection.ConnectionConfig) (pluginDataSourceBinding, error) {
	var binding pluginDataSourceBinding
	if ctx == nil {
		return binding, errors.New("plugin data source request context is required")
	}
	if err := ctx.Err(); err != nil {
		return binding, err
	}
	if _, _, _, valid := plugin.ParseDataSourceType(config.Type); !valid {
		return binding, errors.New("invalid plugin data source type")
	}
	if err := rejectPluginTransport(config); err != nil {
		return binding, err
	}
	owner := a.pluginDataSourceOwner()
	if owner == nil {
		return binding, errors.New("plugin data source lifecycle unavailable")
	}
	owner.mu.RLock()
	shuttingDown := owner.dbShuttingDown
	owner.mu.RUnlock()
	if shuttingDown {
		return binding, errDatabaseConnectionShutdown
	}
	statuses, err := a.pluginDataSourceStatuses(ctx)
	if err != nil {
		return binding, err
	}
	status, _, err := findPluginDataSource(statuses, config.Type)
	if err != nil {
		return binding, err
	}
	if allowed, _ := pluginDataSourceEligible(status, pluginEnvEnabled("GONAVI_DISABLE_PLUGINS")); !allowed {
		return binding, plugin.ErrDisabled
	}
	manager, err := owner.pluginManager(ctx)
	if err != nil {
		return binding, err
	}
	if !manager.OwnsRuntime() {
		owner.plugins.mu.Lock()
		lifetime, closing := owner.plugins.lifetime, owner.plugins.closing
		owner.plugins.mu.Unlock()
		if closing || lifetime == nil {
			return binding, plugin.ErrClosed
		}
		// This is an explicit connection request, not discovery. Never enable a
		// disabled package or clear quarantine, and never take another owner's lease.
		if err := manager.Start(lifetime); err != nil {
			return binding, err
		}
	}
	return awaitPluginDataSource(ctx, manager, config.Type)
}

func awaitPluginDataSource(ctx context.Context, manager *plugin.Manager, identity string) (pluginDataSourceBinding, error) {
	waiting, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		status, source, err := findPluginDataSource(manager.List(), identity)
		if err != nil {
			return pluginDataSourceBinding{}, err
		}
		if allowed, _ := pluginDataSourceEligible(status, pluginEnvEnabled("GONAVI_DISABLE_PLUGINS")); !allowed {
			return pluginDataSourceBinding{}, plugin.ErrDisabled
		}
		if !manager.OwnsRuntime() {
			return pluginDataSourceBinding{}, plugin.ErrDisabled
		}
		if status.State == plugin.StateRunning {
			return pluginDataSourceBinding{manager: manager, status: status, source: source}, nil
		}
		select {
		case <-waiting.Done():
			return pluginDataSourceBinding{}, waiting.Err()
		case <-ticker.C:
		}
	}
}

func (a *App) openPluginDataSource(ctx context.Context, config connection.ConnectionConfig) (db.Database, error) {
	if ctx == nil {
		return nil, errors.New("plugin data source request context is required")
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
		return nil, err
	}
	return a.connectPluginDataSource(ctx, resolved, binding)
}

func (a *App) connectPluginDataSource(ctx context.Context, config connection.ConnectionConfig, binding pluginDataSourceBinding) (*db.PluginDatabase, error) {
	validateQuery := func(query string) error { return nil }
	// A declared writable source still stays query-read-only until this
	// connection explicitly opts in. Exec and transaction entry points apply
	// the same policy at the application layer.
	if !pluginDataSourceWriteEnabled(binding.source.ReadOnly, config) {
		validateQuery = func(query string) error { return validatePluginReadOnlyQuery(config.Type, query, a.appText) }
	}
	instance, err := db.NewPluginDatabase(binding.manager, binding.status, binding.source, validateQuery)
	if err != nil {
		return nil, err
	}
	if err := instance.ConnectContext(ctx, config); err != nil {
		if closeErr := instance.Close(); closeErr != nil {
			return nil, errors.Join(err, closeErr)
		}
		return nil, err
	}
	if !instance.IsCurrent() {
		if closeErr := instance.Close(); closeErr != nil {
			return nil, errors.Join(plugin.ErrDisabled, closeErr)
		}
		return nil, plugin.ErrDisabled
	}
	return instance, nil
}
