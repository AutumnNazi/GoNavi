package provider

import "strings"

// defaultOpenAIResponsesReasoningMaxOutputTokens 是推理模型未配置输出上限时的默认值。
// Responses 的 max_output_tokens 同时计入隐藏推理和可见正文。OpenAI 建议至少预留 25000，
// 否则响应会以 incomplete / max_output_tokens 结束，助手只能看到报错。
const defaultOpenAIResponsesReasoningMaxOutputTokens = 32768

func openAIResponsesDefaultMaxOutputTokens(model string) int {
	if openAIResponsesReasoningModel(model) {
		return defaultOpenAIResponsesReasoningMaxOutputTokens
	}
	return defaultOpenAIMaxTokens
}

// openAIResponsesReasoningModel 识别会把推理 token 计入 max_output_tokens 的模型。
// 只匹配 OpenAI 推理系列，避免把兼容网关或 DeepSeek 的默认额度一起抬高。
func openAIResponsesReasoningModel(model string) bool {
	name := strings.ToLower(strings.TrimSpace(model))
	if slash := strings.LastIndex(name, "/"); slash >= 0 {
		name = name[slash+1:]
	}
	switch {
	case strings.HasPrefix(name, "gpt-5"),
		strings.HasPrefix(name, "o1"),
		strings.HasPrefix(name, "o3"),
		strings.HasPrefix(name, "o4"):
		return true
	default:
		return false
	}
}
