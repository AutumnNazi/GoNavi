package aiservice

import (
	"context"
	"encoding/json"
	"errors"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/ai/runharness"
)

func (s *Service) bindPluginAgentInput(ctx context.Context, request *runharness.AgentInputRequest, selected ai.ProviderConfig) error {
	if ctx == nil || request == nil {
		return errors.New("plugin provider input context is required")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	// Validate raw identity/transport before secret resolution or builtin handling.
	if err := validatePluginProviderConfig(selected); err != nil {
		return err
	}
	resolved, err := s.resolveProviderConfigSecrets(selected)
	if err != nil {
		return err
	}
	resolved = pluginProviderSendOptions(resolved, ai.ChatSendOptions{Model: request.Model, ThinkingIntensity: request.Thinking})
	if request.Temperature != nil {
		resolved.Temperature = *request.Temperature
	}
	if request.MaxTokens != nil {
		resolved.MaxTokens = *request.MaxTokens
	}
	if err := validatePluginProviderConfig(resolved); err != nil {
		return err
	}
	factory, err := s.pluginProviderFactory()
	if err != nil {
		return err
	}
	encoded, err := factory.Bind(ctx, resolved)
	if err != nil {
		return err
	}
	binding, err := runharness.NewProviderBinding(resolved.ID, encoded)
	if err != nil {
		return err
	}
	if err := request.SetProviderBinding(binding); err != nil {
		return err
	}
	request.Provider = binding.ProviderID
	return nil
}

func (s *Service) resolvePluginAgentProvider(ctx context.Context, raw json.RawMessage, config ai.ProviderConfig) (provider.Provider, error) {
	if err := validatePluginProviderConfig(config); err != nil {
		return nil, err
	}
	factory, err := s.pluginProviderFactory()
	if err != nil {
		return nil, err
	}
	// Pass the original flat object, not the ordinary DTO which omits private pin.
	return factory.Resolve(ctx, append(json.RawMessage(nil), raw...))
}
