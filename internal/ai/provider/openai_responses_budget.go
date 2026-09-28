package provider

import "strings"

// defaultOpenAIResponsesReasoningMaxOutputTokens 是 Responses 推理模型未配置输出上限时的默认值。
// Responses 的 max_output_tokens 同时计入隐藏推理和可见正文。OpenAI 与 DeepSeek 的
// 兼容端点都可能在正文输出前耗尽该额度，否则响应会以 incomplete / max_output_tokens 结束。
const defaultOpenAIResponsesReasoningMaxOutputTokens = 32768

func openAIResponsesDefaultMaxOutputTokens(model string) int {
	if openAIResponsesReasoningModel(model) {
		return defaultOpenAIResponsesReasoningMaxOutputTokens
	}
	return defaultOpenAIMaxTokens
}

// openAIResponsesDefaultMaxOutputTokensForEndpoint also recognizes a native
// DeepSeek endpoint when a gateway uses a model alias without the "deepseek"
// prefix. DeepSeek Responses enables thinking by default, so a chat-shaped
// alias must receive the same reasoning budget as its canonical model name.
func openAIResponsesDefaultMaxOutputTokensForEndpoint(model, baseURL string) int {
	if isDeepSeekResponsesBaseURL(baseURL) {
		return defaultOpenAIResponsesReasoningMaxOutputTokens
	}
	return openAIResponsesDefaultMaxOutputTokens(model)
}

// normalizeOpenAIResponsesModelName removes a gateway namespace before model
// capability checks. Providers commonly expose names such as
// "deepseek/deepseek-v4-flash-0731".
func normalizeOpenAIResponsesModelName(model string) string {
	name := strings.ToLower(strings.TrimSpace(model))
	if slash := strings.LastIndex(name, "/"); slash >= 0 {
		name = name[slash+1:]
	}
	return strings.TrimSpace(name)
}

// openAIResponsesReasoningModel 识别会把推理 token 计入 max_output_tokens 的模型。
// 除 OpenAI 推理系列外，DeepSeek Responses 模型也必须提高预算；兼容网关
// 往往只在模型名中保留 deepseek 别名，不能只按请求域名判断。
func openAIResponsesReasoningModel(model string) bool {
	name := normalizeOpenAIResponsesModelName(model)
	switch {
	case strings.HasPrefix(name, "gpt-5"),
		strings.HasPrefix(name, "o1"),
		strings.HasPrefix(name, "o3"),
		strings.HasPrefix(name, "o4"),
		strings.Contains(name, "deepseek"):
		return true
	default:
		return false
	}
}

// normalizeOpenAIResponsesMaxOutputTokens applies the model-aware default only
// when the caller did not provide a budget. Positive values remain explicit
// user choices, including a deliberately small limit for short tasks.
func normalizeOpenAIResponsesMaxOutputTokens(model string, maxTokens int) int {
	if maxTokens <= 0 {
		return openAIResponsesDefaultMaxOutputTokens(model)
	}
	return maxTokens
}

func normalizeOpenAIResponsesMaxOutputTokensForEndpoint(model, baseURL string, maxTokens int) int {
	if maxTokens <= 0 {
		return openAIResponsesDefaultMaxOutputTokensForEndpoint(model, baseURL)
	}
	return maxTokens
}
