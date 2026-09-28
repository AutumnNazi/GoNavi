package provider

import (
	"strings"

	"GoNavi-Wails/internal/ai"
)

// openAIResponsesRequestMaxOutputTokens resolves the per-turn budget without
// allowing an omitted or negative request override to erase the model-aware
// provider default.
func openAIResponsesRequestMaxOutputTokens(model, baseURL string, requestMaxTokens, configuredMaxTokens int) int {
	if requestMaxTokens > 0 {
		return requestMaxTokens
	}
	return normalizeOpenAIResponsesMaxOutputTokensForEndpoint(model, baseURL, configuredMaxTokens)
}

// openAIResponsesRequestReasoning maps the persisted thinking preference to a
// Responses reasoning object. DeepSeek-compatible endpoints enable thinking
// when the field is omitted, so an explicit off selection must be represented
// as effort=none even when a gateway hides the DeepSeek hostname.
func openAIResponsesRequestReasoning(model, baseURL, rawIntensity string) *openAIResponsesReasoning {
	intensity := NormalizeThinkingIntensity(rawIntensity)
	if intensity == "" {
		return nil
	}

	effort := openAIReasoningEffort(intensity)
	if effort == "" && intensity == ai.ThinkingIntensityOff &&
		(isDeepSeekResponsesBaseURL(baseURL) || openAIResponsesReasoningModel(model)) {
		effort = "none"
	}
	if effort == "" {
		return nil
	}

	reasoning := &openAIResponsesReasoning{Effort: effort}
	if !isDeepSeekResponsesBaseURL(baseURL) && !strings.Contains(strings.ToLower(model), "deepseek") {
		reasoning.Summary = "auto"
	}
	return reasoning
}
