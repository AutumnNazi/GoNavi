package aiservice

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/plugin"

	"github.com/google/uuid"
)

func (s *Service) preparePluginProviderSave(config ai.ProviderConfig) (ai.ProviderConfig, error) {
	if !isPluginProviderConfig(config) {
		return config, nil
	}
	if config.ID == "" {
		config.ID = "provider-" + uuid.New().String()[:8]
	}
	if err := validatePluginProviderConfig(config); err != nil {
		return config, s.serviceErrorLocked("ai_service.backend.error.provider_test_unsupported", map[string]any{"protocol": "plugin"}, err)
	}
	return config, nil
}

func (s *Service) pluginProviderDeclaration(ctx context.Context, config ai.ProviderConfig) (provider.PluginProviderView, error) {
	if _, _, ok := plugin.ParseAIProviderType(config.Type); !ok || strings.EqualFold(strings.TrimSpace(config.ID), builtinAIProviderID) {
		return provider.PluginProviderView{}, errors.New("plugin provider identity is unavailable")
	}
	factory, err := s.pluginProviderFactory()
	if err != nil {
		return provider.PluginProviderView{}, err
	}
	declarations, err := factory.Catalog(ctx)
	if err != nil {
		return provider.PluginProviderView{}, err
	}
	for _, declaration := range declarations {
		if declaration.Type == config.Type {
			return declaration, nil
		}
	}
	return provider.PluginProviderView{}, errors.New("plugin provider declaration is unavailable")
}

func (s *Service) pluginProviderModels(config ai.ProviderConfig) map[string]interface{} {
	declaration, err := s.pluginProviderDeclaration(s.agentLifecycleContext(), config)
	models := make([]string, 0, len(declaration.Models))
	for _, model := range declaration.Models {
		models = append(models, model.ID)
	}
	if err != nil || !declaration.Available {
		return map[string]interface{}{"success": false, "models": models, "source": "plugin-declaration", "error": s.serviceText("ai_service.backend.error.provider_test_unsupported", map[string]any{"protocol": "plugin"})}
	}
	return map[string]interface{}{"success": true, "models": models, "source": "plugin-declaration"}
}

func (s *Service) pluginProviderContextProfile(config ai.ProviderConfig) ai.ModelContextProfile {
	unavailable := ai.ModelContextProfile{Options: []int{}}
	declaration, err := s.pluginProviderDeclaration(s.agentLifecycleContext(), config)
	if err != nil {
		return unavailable
	}
	for _, model := range declaration.Models {
		if model.ID != config.Model {
			continue
		}
		options := []int{}
		for size := 1024; size < model.ContextWindow; size *= 2 {
			options = append(options, size)
		}
		options = append(options, model.ContextWindow)
		if config.ContextWindow > 0 && config.ContextWindow < model.ContextWindow {
			found := false
			for _, size := range options {
				if size == config.ContextWindow {
					found = true
					break
				}
			}
			if !found {
				options = append(options, config.ContextWindow)
				sort.Ints(options)
			}
		}
		return ai.ModelContextProfile{DefaultWindow: model.ContextWindow, Options: options}
	}
	return unavailable
}

func (s *Service) testPluginProvider(config ai.ProviderConfig) map[string]interface{} {
	if err := validatePluginProviderConfig(config); err != nil {
		return s.providerTestResult("model-response", errors.New("plugin provider configuration is invalid"))
	}
	resolved, err := s.resolvePluginProviderDraft(config)
	if err != nil {
		return s.providerTestResult("model-response", errors.New("selected provider credential is unavailable"))
	}
	ctx, cancel := context.WithTimeout(s.agentLifecycleContext(), 15*time.Second)
	defer cancel()
	instance, err := s.newPluginProvider(ctx, resolved)
	if err != nil {
		return s.providerTestResult("model-response", errors.New("plugin provider is unavailable"))
	}
	response, err := instance.Chat(ctx, ai.ChatRequest{Messages: []ai.Message{{Role: "user", Content: "Reply briefly to confirm this model is available."}}, Temperature: 0, MaxTokens: 1})
	if err != nil {
		return s.providerTestResult("model-response", errors.New("plugin provider model check failed"))
	}
	if response == nil || (response.Content == "" && response.ReasoningContent == "") {
		return s.providerTestResult("model-response", errors.New("plugin provider returned no model response"))
	}
	return s.providerTestResult("model-response", nil)
}
