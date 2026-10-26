package app

import (
	"context"
	"errors"
	"sort"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/plugin"
)

// PluginDataSourceView describes an installed contribution without secrets.
// ReadOnly is the manifest declaration; a writable source still obeys the
// connection-level protection settings chosen by the user.
type PluginDataSourceView struct {
	Type        string       `json:"type"`
	PluginID    string       `json:"pluginId"`
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Dialect     string       `json:"dialect"`
	DefaultPort int          `json:"defaultPort"`
	Version     string       `json:"version"`
	Generation  uint64       `json:"generation"`
	Available   bool         `json:"available"`
	Connectable bool         `json:"connectable"`
	State       plugin.State `json:"state"`
	ReadOnly    bool         `json:"readOnly"`
	Reason      string       `json:"reason,omitempty"`
}

// PluginDataSourceCatalog is a discovery snapshot; Items is never null.
type PluginDataSourceCatalog struct {
	Items []PluginDataSourceView `json:"items"`
}

func (a *App) pluginDataSourceOwner() *App {
	return a.pluginRuntimeOwner()
}

func (a *App) pluginDataSourceOwnsRuntime() bool {
	return a.pluginRuntimeOwnsRuntime()
}

func (a *App) pluginDataSourceContext() context.Context {
	return a.pluginRuntimeContext()
}

func (a *App) pluginDataSourceStatuses(ctx context.Context) ([]plugin.Status, error) {
	return a.pluginRuntimeStatuses(ctx)
}

func pluginDataSourceEligible(status plugin.Status, safeMode bool) (bool, string) {
	if safeMode {
		return false, "safe_mode"
	}
	if !status.DesiredEnabled {
		return false, "disabled"
	}
	switch status.State {
	case plugin.StateFaulted:
		return false, "faulted"
	case plugin.StateBlocked:
		return false, "blocked"
	case plugin.StateStopping:
		return false, "stopping"
	case plugin.StateStarting:
		return true, "starting"
	case plugin.StateDisabled:
		return true, "runtime_unavailable"
	case plugin.StateRunning:
		return true, ""
	default:
		return false, "runtime_unavailable"
	}
}

func pluginDataSourcePermitted(manifest plugin.Manifest) bool {
	for _, permission := range manifest.Permissions {
		if permission == "data.sources" {
			return true
		}
	}
	return false
}

func pluginDataSourceViews(statuses []plugin.Status, safeMode, owned bool) []PluginDataSourceView {
	items := make([]PluginDataSourceView, 0)
	for _, status := range statuses {
		if !pluginDataSourcePermitted(status.Manifest) || status.Generation > 1<<53-1 {
			continue
		}
		connectable, reason := pluginDataSourceEligible(status, safeMode)
		available := connectable && owned && status.State == plugin.StateRunning
		if connectable && !owned && reason == "" {
			reason = "runtime_unavailable"
		}
		for _, source := range status.Manifest.Contributes.DataSources {
			identity := plugin.DataSourceType(status.Manifest.ID, source)
			if identity == "" || source.Name == "" || status.Manifest.Version == "" {
				continue
			}
			items = append(items, PluginDataSourceView{Type: identity, PluginID: status.Manifest.ID, ID: source.ID, Name: source.Name, Dialect: source.Dialect,
				DefaultPort: source.DefaultPort, Version: status.Manifest.Version, Generation: status.Generation, Available: available, Connectable: connectable, State: status.State, ReadOnly: source.ReadOnly, Reason: reason})
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Type < items[j].Type })
	return items
}

func (a *App) ensurePluginDataSourceConnectable(config connection.ConnectionConfig) error {
	statuses, err := a.pluginDataSourceStatuses(a.pluginDataSourceContext())
	if err == nil {
		for _, item := range pluginDataSourceViews(statuses, pluginEnvEnabled("GONAVI_DISABLE_PLUGINS"), a.pluginDataSourceOwnsRuntime()) {
			if item.Type == config.Type && item.Connectable {
				return nil
			}
		}
	}
	return errors.New(a.appText("query_editor.message.unsupported_source", nil))
}

// pluginDataSourceWriteEnabled keeps a declared writable source closed until the
// connection itself opts in and the legacy read-only switch is off.
func pluginDataSourceWriteEnabled(sourceReadOnly bool, config connection.ConnectionConfig) bool {
	return !sourceReadOnly && config.PluginWritable && !config.ReadOnly
}

func (a *App) pluginDataSourceCapability(config connection.ConnectionConfig) DataSourceCapability {
	capability := DataSourceCapability{DatabaseType: config.Type, UI: DataSourceUICapabilities{ForceReadOnlyQueryResult: true, ForceReadOnlyStructureDesigner: true}}
	writable := false
	unsupported := DataSourceOperationCapability{Reason: "plugin_data_source_unavailable", MessageKey: "query_editor.message.unsupported_source"}
	capability.Query, capability.Metadata = unsupported, unsupported
	if _, ok := pluginDataSourceDialect(config.Type); !ok {
		return capability
	}
	statuses, err := a.pluginDataSourceStatuses(a.pluginDataSourceContext())
	if err != nil {
		return capability
	}
	for _, item := range pluginDataSourceViews(statuses, pluginEnvEnabled("GONAVI_DISABLE_PLUGINS"), a.pluginDataSourceOwnsRuntime()) {
		if item.Type == config.Type && item.Available {
			capability.Query = DataSourceOperationCapability{Supported: true}
			capability.Metadata = DataSourceOperationCapability{Supported: true}
			capability.Cancel = DataSourceOperationCapability{Supported: true}
			writable = pluginDataSourceWriteEnabled(item.ReadOnly, config)
			if writable {
				capability.Transaction = DataSourceOperationCapability{Supported: true}
				capability.UI.ForceReadOnlyQueryResult = false
				capability.UI.ForceReadOnlyStructureDesigner = false
			}
			return capability
		}
	}
	return capability
}
