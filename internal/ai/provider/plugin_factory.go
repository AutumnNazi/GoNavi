package provider

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/plugin"
)

type pluginProviderPin struct {
	PluginID   string `json:"pluginId"`
	ProviderID string `json:"providerId"`
	Version    string `json:"version"`
	Digest     string `json:"digest"`
	Generation uint64 `json:"generation"`
}

type pluginFrozenConfig struct {
	ai.ProviderConfig
	Runtime *pluginProviderPin `json:"_pluginRuntime"`
}

// Bind freezes the selected secret and declaration epoch in a flat encrypted-binding payload.
func (f *PluginFactory) Bind(ctx context.Context, c ai.ProviderConfig) (json.RawMessage, error) {
	if ctx == nil {
		return nil, ErrPluginProviderUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := ValidatePluginConfig(c); err != nil {
		return nil, err
	}
	id, pid, _ := plugin.ParseAIProviderType(c.Type)
	manager, err := f.manager(ctx)
	if err != nil {
		return nil, err
	}
	status, decl, err := waitPluginProvider(ctx, manager, id, pid)
	if err != nil {
		return nil, err
	}
	c = selectedPluginConfig(c, decl.SupportsImages)
	if err = bindPluginModel(&c, decl); err != nil {
		return nil, err
	}
	pin := &pluginProviderPin{PluginID: id, ProviderID: pid, Version: status.Manifest.Version, Digest: status.Digest, Generation: status.Generation}
	if _, _, err = f.current(ctx, *pin, manager); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(pluginFrozenConfig{ProviderConfig: c, Runtime: pin})
	if err != nil {
		return nil, ErrPluginProviderConfig
	}
	return raw, nil
}

// Resolve uses only the encrypted frozen payload; it never rebinds a fresh generation.
func (f *PluginFactory) Resolve(ctx context.Context, raw json.RawMessage) (Provider, error) {
	if ctx == nil {
		return nil, ErrPluginProviderUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pluginJSON(raw, 128<<10); err != nil {
		return nil, ErrPluginProviderConfig
	}
	var frozen pluginFrozenConfig
	if err := pluginDecodeObject(raw, &frozen); err != nil || frozen.Runtime == nil {
		return nil, ErrPluginProviderConfig
	}
	if err := ValidatePluginConfig(frozen.ProviderConfig); err != nil {
		return nil, err
	}
	id, pid, _ := plugin.ParseAIProviderType(frozen.Type)
	pin := *frozen.Runtime
	if pin.PluginID != id || pin.ProviderID != pid || pin.Generation == 0 || pin.Generation > 1<<53-1 || !pluginDigest(pin.Digest) || !pluginText(pin.Version, 128, false) {
		return nil, ErrPluginProviderConfig
	}
	manager, decl, err := f.current(ctx, pin, nil)
	if err != nil {
		return nil, err
	}
	c := selectedPluginConfig(frozen.ProviderConfig, decl.SupportsImages)
	if c.ContextWindow == 0 {
		return nil, ErrPluginProviderConfig
	}
	if err = bindPluginModel(&c, decl); err != nil {
		return nil, err
	}
	return newPluginProvider(f, manager, pin, c, decl), nil
}

// New binds once and resolves exactly that binding.
func (f *PluginFactory) New(ctx context.Context, c ai.ProviderConfig) (Provider, error) {
	raw, err := f.Bind(ctx, c)
	if err != nil {
		return nil, err
	}
	return f.Resolve(ctx, raw)
}

func (f *PluginFactory) manager(ctx context.Context) (*plugin.Manager, error) {
	if ctx == nil {
		return nil, ErrPluginProviderUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f == nil || f.managerSource == nil {
		return nil, ErrPluginProviderUnavailable
	}
	m, err := f.managerSource(ctx)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil || m == nil || !m.OwnsRuntime() {
		return nil, ErrPluginProviderUnavailable
	}
	return m, nil
}

func (f *PluginFactory) current(ctx context.Context, pin pluginProviderPin, expected *plugin.Manager) (*plugin.Manager, plugin.AIProvider, error) {
	m, err := f.manager(ctx)
	if err != nil {
		return nil, plugin.AIProvider{}, err
	}
	if expected != nil && m != expected {
		return nil, plugin.AIProvider{}, ErrPluginProviderUnavailable
	}
	status, decl, ok := findPluginProvider(m.List(), pin.PluginID, pin.ProviderID)
	if !ok || pluginProviderReason(status, true, false) != "" || status.Digest != pin.Digest || status.Generation != pin.Generation || status.Manifest.Version != pin.Version {
		return nil, plugin.AIProvider{}, ErrPluginProviderUnavailable
	}
	if err = m.CheckAIProviderGeneration(ctx, pin.PluginID, pin.Generation, pin.ProviderID, pin.Digest); err != nil {
		if ctx.Err() != nil {
			return nil, plugin.AIProvider{}, ctx.Err()
		}
		return nil, plugin.AIProvider{}, ErrPluginProviderUnavailable
	}
	if err = ctx.Err(); err != nil {
		return nil, plugin.AIProvider{}, err
	}
	return m, decl, nil
}

func findPluginProvider(statuses []plugin.Status, id, pid string) (plugin.Status, plugin.AIProvider, bool) {
	for _, s := range statuses {
		if s.Manifest.ID != id || !pluginProviderPermission(s.Manifest) {
			continue
		}
		for _, d := range s.Manifest.Contributes.AIProviders {
			if d.ID == pid && plugin.AIProviderType(id, d) != "" {
				return s, d, true
			}
		}
	}
	return plugin.Status{}, plugin.AIProvider{}, false
}

func waitPluginProvider(ctx context.Context, m *plugin.Manager, id, pid string) (plugin.Status, plugin.AIProvider, error) {
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return plugin.Status{}, plugin.AIProvider{}, err
		}
		s, d, ok := findPluginProvider(m.List(), id, pid)
		if !m.OwnsRuntime() || !ok || !s.DesiredEnabled {
			return s, d, ErrPluginProviderUnavailable
		}
		if s.State == plugin.StateRunning && s.Generation != 0 && s.Generation <= 1<<53-1 && pluginDigest(s.Digest) {
			return s, d, nil
		}
		if s.State != plugin.StateStarting {
			return s, d, ErrPluginProviderUnavailable
		}
		select {
		case <-ctx.Done():
			return s, d, ctx.Err()
		case <-timer.C:
			return s, d, ErrPluginProviderUnavailable
		case <-ticker.C:
		}
	}
}

func bindPluginModel(c *ai.ProviderConfig, d plugin.AIProvider) error {
	for _, model := range d.Models {
		if model.ID != c.Model {
			continue
		}
		if c.ContextWindow == 0 {
			c.ContextWindow = model.ContextWindow
		}
		if c.ContextWindow > model.ContextWindow || c.MaxTokens > model.MaxOutputTokens || c.MaxTokens > c.ContextWindow {
			return ErrPluginProviderConfig
		}
		return nil
	}
	return ErrPluginProviderConfig
}
func pluginDigest(value string) bool {
	return len(value) == 64 && strings.Trim(value, "0123456789abcdef") == ""
}
