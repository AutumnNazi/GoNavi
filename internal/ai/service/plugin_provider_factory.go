package aiservice

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/plugin"
)

// ConfigurePluginProviderFactory attaches a lifecycle-owned provider extension.
// A package function keeps authority callbacks off reflective Service bindings.
func ConfigurePluginProviderFactory(service *Service, factory *provider.PluginFactory) error {
	if service == nil || factory == nil {
		return errors.New("plugin provider integration is unavailable")
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	if service.pluginProviders != nil && service.pluginProviders != factory {
		return errors.New("plugin provider integration is already configured")
	}
	service.pluginProviders = factory
	return nil
}

func (s *Service) pluginProviderFactory() (*provider.PluginFactory, error) {
	if s == nil {
		return nil, errors.New("plugin provider integration is unavailable")
	}
	s.mu.RLock()
	factory := s.pluginProviders
	s.mu.RUnlock()
	if factory == nil {
		return nil, errors.New("plugin provider integration is unavailable")
	}
	return factory, nil
}

func isPluginProviderConfig(config ai.ProviderConfig) bool {
	return plugin.IsAIProviderNamespace(config.Type)
}

func isPluginProviderBinding(config ai.ProviderConfig, raw json.RawMessage) bool {
	if isPluginProviderConfig(config) {
		return true
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return false
	}
	for key := range fields {
		if strings.EqualFold(key, "_pluginRuntime") {
			return true
		}
	}
	return false
}

func validatePluginProviderConfig(config ai.ProviderConfig) error {
	if !isPluginProviderConfig(config) {
		return nil
	}
	if strings.EqualFold(strings.TrimSpace(config.ID), builtinAIProviderID) {
		return errors.New("plugin provider cannot claim the built-in identity")
	}
	return provider.ValidatePluginConfig(config)
}

func (s *Service) newPluginProvider(ctx context.Context, config ai.ProviderConfig) (provider.Provider, error) {
	if ctx == nil {
		return nil, errors.New("plugin provider context is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := validatePluginProviderConfig(config); err != nil {
		return nil, err
	}
	factory, err := s.pluginProviderFactory()
	if err != nil {
		return nil, err
	}
	return factory.New(ctx, cloneAgentProviderConfig(config))
}

func pluginProviderSendOptions(config ai.ProviderConfig, options ai.ChatSendOptions) ai.ProviderConfig {
	config = cloneAgentProviderConfig(config)
	if options.Model != "" {
		config.Model = options.Model
	}
	if options.ThinkingIntensity != "" {
		config.ThinkingIntensity = options.ThinkingIntensity
	}
	return config
}
