package provider

import (
	"fmt"
	"strings"

	"GoNavi-Wails/internal/ai"
)

// NewProvider 根据配置创建 Provider 实例
func NewProvider(config ai.ProviderConfig) (Provider, error) {
	providerType := strings.ToLower(strings.TrimSpace(config.Type))
	switch providerType {
	case "openai":
		if strings.EqualFold(strings.TrimSpace(config.APIFormat), "openai-responses") {
			return NewOpenAIResponsesProvider(config)
		}
		return NewOpenAIProvider(config)
	case "anthropic":
		return NewAnthropicProvider(config)
	case "gemini":
		return NewGeminiProvider(config)
	case "custom":
		return NewCustomProvider(config)
	default:
		return nil, fmt.Errorf("unsupported AI provider type: %s", config.Type)
	}
}
