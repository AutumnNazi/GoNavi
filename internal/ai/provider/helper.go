package provider

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

var openAICompatibleVersionSuffixPattern = regexp.MustCompile(`(?i)(^|/)v\d+$`)

// ParseDataURI 解析前端传递的 Data URI，返回 mimeType 和去掉前缀的 rawBase64
func ParseDataURI(dataURI string) (mimeType, rawBase64 string, err error) {
	if !strings.HasPrefix(dataURI, "data:") {
		// 如果前端漏了前缀，默认容错当做 jpeg 处理
		return "image/jpeg", dataURI, nil
	}
	parts := strings.SplitN(dataURI, ",", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("invalid data URI format")
	}
	meta := strings.TrimPrefix(parts[0], "data:")
	metaParts := strings.Split(meta, ";")
	mimeType = metaParts[0]
	if mimeType == "" {
		mimeType = "image/jpeg" // fallback
	}
	rawBase64 = parts[1]
	return mimeType, rawBase64, nil
}

// NormalizeOpenAICompatibleBaseURL 统一归一化 OpenAI 兼容服务的 base URL。
func NormalizeOpenAICompatibleBaseURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return defaultOpenAIBaseURL
	}

	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return normalizeOpenAICompatibleBaseURLString(trimmed)
	}

	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.Path = normalizeOpenAICompatiblePath(parsed.Path)
	return strings.TrimRight(parsed.String(), "/")
}

// ResolveOpenAICompatibleEndpoint 基于归一化 base URL 拼接 OpenAI 兼容接口路径。
func ResolveOpenAICompatibleEndpoint(baseURL string, endpoint string) string {
	normalizedBaseURL := NormalizeOpenAICompatibleBaseURL(baseURL)
	normalizedEndpoint := strings.TrimLeft(strings.TrimSpace(endpoint), "/")
	if normalizedEndpoint == "" {
		return normalizedBaseURL
	}
	return normalizedBaseURL + "/" + normalizedEndpoint
}

func normalizeOpenAICompatibleBaseURLString(raw string) string {
	normalized := strings.TrimRight(strings.TrimSpace(raw), "/")
	if normalized == "" {
		return defaultOpenAIBaseURL
	}

	lower := strings.ToLower(normalized)
	switch {
	case strings.HasSuffix(lower, "/chat/completions"):
		normalized = normalized[:len(normalized)-len("/chat/completions")]
	case strings.HasSuffix(lower, "/responses"):
		normalized = normalized[:len(normalized)-len("/responses")]
	case strings.HasSuffix(lower, "/models"):
		normalized = normalized[:len(normalized)-len("/models")]
	}
	normalized = strings.TrimRight(normalized, "/")
	if openAICompatibleVersionSuffixPattern.MatchString(normalized) {
		return normalized
	}
	return normalized + "/v1"
}

func normalizeOpenAICompatiblePath(path string) string {
	normalized := strings.TrimRight(strings.TrimSpace(path), "/")
	lower := strings.ToLower(normalized)
	switch {
	case strings.HasSuffix(lower, "/chat/completions"):
		normalized = normalized[:len(normalized)-len("/chat/completions")]
	case strings.HasSuffix(lower, "/responses"):
		normalized = normalized[:len(normalized)-len("/responses")]
	case strings.HasSuffix(lower, "/models"):
		normalized = normalized[:len(normalized)-len("/models")]
	}
	normalized = strings.TrimRight(normalized, "/")
	if openAICompatibleVersionSuffixPattern.MatchString(normalized) {
		return normalized
	}
	if normalized == "" {
		return "/v1"
	}
	return normalized + "/v1"
}
