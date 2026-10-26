package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/ai/runharness"
	aiservice "GoNavi-Wails/internal/ai/service"
	"GoNavi-Wails/internal/plugin"
)

func (r *cliProviderResolver) providerForBinding(ctx context.Context, request *runharness.AgentInputRequest) (ai.ProviderConfig, error) {
	store := aiservice.NewProviderConfigStore(r.root, nil)
	// Inspect preserves plugin identities and foreign fields without resolving
	// secrets. Reject these before LoadRuntime can treat an ID as hosted AI.
	inspection, err := store.Inspect()
	if err != nil {
		return ai.ProviderConfig{}, fmt.Errorf("load AI provider configuration: %w", err)
	}
	selected, err := selectCLIProvider(inspection.Snapshot, request.Provider)
	if err != nil {
		return ai.ProviderConfig{}, err
	}
	if plugin.IsAIProviderNamespace(selected.Type) {
		if _, err := applyCLIPluginProviderOverrides(selected, request); err != nil {
			return ai.ProviderConfig{}, err
		}
	}
	if err := ctx.Err(); err != nil {
		return ai.ProviderConfig{}, err
	}
	snapshot, err := store.LoadRuntime()
	if err != nil {
		return ai.ProviderConfig{}, fmt.Errorf("load AI provider configuration: %w", err)
	}
	selected, err = selectCLIProvider(snapshot, selected.ID)
	if err != nil {
		return ai.ProviderConfig{}, err
	}
	if plugin.IsAIProviderNamespace(selected.Type) {
		return applyCLIPluginProviderOverrides(selected, request)
	}
	if value := strings.TrimSpace(request.Model); value != "" {
		selected.Model = value
	}
	if value := strings.TrimSpace(request.Thinking); value != "" {
		selected.ThinkingIntensity = value
	}
	if request.Temperature != nil {
		selected.Temperature = *request.Temperature
	}
	if request.MaxTokens != nil {
		selected.MaxTokens = *request.MaxTokens
	}
	return cloneCLIProviderConfig(selected), ctx.Err()
}

func applyCLIPluginProviderOverrides(config ai.ProviderConfig, request *runharness.AgentInputRequest) (ai.ProviderConfig, error) {
	// Plugin model and thinking inputs are validated exactly as supplied. Legacy
	// presets must not trim, remap or silently clear unsupported transport fields.
	if request.Model != "" {
		config.Model = request.Model
	}
	if request.Thinking != "" {
		config.ThinkingIntensity = request.Thinking
	}
	if request.Temperature != nil {
		config.Temperature = *request.Temperature
	}
	if request.MaxTokens != nil {
		config.MaxTokens = *request.MaxTokens
	}
	if err := provider.ValidatePluginConfig(config); err != nil {
		return ai.ProviderConfig{}, err
	}
	return cloneCLIProviderConfig(config), nil
}

func (r *cliProviderResolver) bindProviderConfig(ctx context.Context, selected ai.ProviderConfig) (runharness.ProviderBinding, error) {
	if err := ctx.Err(); err != nil {
		return runharness.ProviderBinding{}, err
	}
	if !plugin.IsAIProviderNamespace(selected.Type) {
		return runharness.NewProviderBinding(selected.ID, selected)
	}
	if err := provider.ValidatePluginConfig(selected); err != nil {
		return runharness.ProviderBinding{}, err
	}
	if r.plugins == nil {
		return runharness.ProviderBinding{}, errors.New("local plugin provider factory unavailable")
	}
	raw, err := r.plugins.Bind(ctx, selected)
	if err != nil {
		return runharness.ProviderBinding{}, err
	}
	// RawMessage keeps the frozen pin and context/output limits in one flat
	// object for the encrypted ledger and existing context budgeting code.
	return runharness.NewProviderBinding(selected.ID, raw)
}

func cliPluginProviderBinding(selected ai.ProviderConfig, raw json.RawMessage) bool {
	if plugin.IsAIProviderNamespace(selected.Type) {
		return true
	}
	var envelope struct {
		Runtime json.RawMessage `json:"_pluginRuntime"`
	}
	return json.Unmarshal(raw, &envelope) == nil && len(envelope.Runtime) != 0
}

func (r *cliProviderResolver) resolvePluginProvider(ctx context.Context, selected ai.ProviderConfig, binding runharness.ProviderBinding) (provider.Provider, error) {
	if selected.ID != binding.ProviderID {
		return nil, fmt.Errorf("%w: plugin provider ID does not match binding", runharness.ErrProviderBindingCorrupt)
	}
	if err := provider.ValidatePluginConfig(selected); err != nil {
		return nil, err
	}
	if r.plugins == nil {
		return nil, errors.New("local plugin provider factory unavailable")
	}
	return r.plugins.Resolve(ctx, binding.Config)
}
