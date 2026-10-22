package provider

import (
	"context"
	"sort"

	"GoNavi-Wails/internal/plugin"
)

// PluginProviderSnapshot is a metadata-only host policy snapshot.
type PluginProviderSnapshot struct {
	Statuses []plugin.Status
	Owned    bool
	SafeMode bool
}

// PluginProviderView contains no secret or provider-generated data.
type PluginProviderView struct {
	Type           string           `json:"type"`
	PluginID       string           `json:"pluginId"`
	ID             string           `json:"id"`
	Name           string           `json:"name"`
	Models         []plugin.AIModel `json:"models"`
	SupportsTools  bool             `json:"supportsTools"`
	SupportsImages bool             `json:"supportsImages"`
	Version        string           `json:"version"`
	Digest         string           `json:"digest"`
	Generation     uint64           `json:"generation"`
	Available      bool             `json:"available"`
	State          plugin.State     `json:"state"`
	Reason         string           `json:"reason,omitempty"`
}

// PluginFactory borrows host callbacks; it never owns or activates a runtime.
type PluginFactory struct {
	catalogSource func(context.Context) (PluginProviderSnapshot, error)
	managerSource func(context.Context) (*plugin.Manager, error)
}

// NewPluginFactory creates an isolated factory without global registration.
func NewPluginFactory(catalogSource func(context.Context) (PluginProviderSnapshot, error), managerSource func(context.Context) (*plugin.Manager, error)) *PluginFactory {
	return &PluginFactory{catalogSource: catalogSource, managerSource: managerSource}
}

// Catalog reads only declaration metadata and preserves disabled entries.
func (f *PluginFactory) Catalog(ctx context.Context) ([]PluginProviderView, error) {
	if ctx == nil {
		return nil, ErrPluginProviderUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f == nil || f.catalogSource == nil {
		return nil, ErrPluginProviderUnavailable
	}
	snapshot, err := f.catalogSource(ctx)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, ErrPluginProviderUnavailable
	}
	result := make([]PluginProviderView, 0)
	for _, status := range snapshot.Statuses {
		if !pluginProviderPermission(status.Manifest) || status.Generation > 1<<53-1 {
			continue
		}
		reason := pluginProviderReason(status, snapshot.Owned, snapshot.SafeMode)
		for _, decl := range status.Manifest.Contributes.AIProviders {
			typ := plugin.AIProviderType(status.Manifest.ID, decl)
			if typ == "" {
				continue
			}
			result = append(result, PluginProviderView{Type: typ, PluginID: status.Manifest.ID, ID: decl.ID, Name: decl.Name, Models: append([]plugin.AIModel{}, decl.Models...), SupportsTools: decl.SupportsTools, SupportsImages: decl.SupportsImages, Version: status.Manifest.Version, Digest: status.Digest, Generation: status.Generation, Available: reason == "", State: status.State, Reason: reason})
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Type < result[j].Type })
	return result, nil
}

func pluginProviderPermission(m plugin.Manifest) bool {
	if m.Backend == nil {
		return false
	}
	for _, permission := range m.Permissions {
		if permission == "ai.providers" {
			return true
		}
	}
	return false
}
func pluginProviderReason(s plugin.Status, owned, safe bool) string {
	if safe {
		return "safe_mode"
	}
	if !s.DesiredEnabled {
		return "disabled"
	}
	switch s.State {
	case plugin.StateStarting:
		return "starting"
	case plugin.StateStopping:
		return "stopping"
	case plugin.StateFaulted:
		return "faulted"
	case plugin.StateBlocked:
		return "blocked"
	case plugin.StateRunning:
		if owned && s.Generation != 0 {
			return ""
		}
	}
	return "runtime_unavailable"
}
