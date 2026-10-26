package provider

import (
	"math"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/plugin"
)

var pluginModelID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,127}$`)
var pluginHeaderName = regexp.MustCompile("^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$")

// ValidatePluginConfig performs no IO, keyring lookup, normalization or activation.
func ValidatePluginConfig(c ai.ProviderConfig) error {
	if _, _, ok := plugin.ParseAIProviderType(c.Type); !ok {
		return ErrPluginProviderConfig
	}
	if strings.EqualFold(strings.TrimSpace(c.ID), "gonavi-ai") || !pluginText(c.ID, 128, true) || !pluginText(c.Name, 256, true) || !pluginModelID.MatchString(c.Model) {
		return ErrPluginProviderConfig
	}
	if c.APIFormat != "" || c.CLIPath != "" || len(c.CLIEnv) != 0 || c.Effort != "" || c.ThinkingIntensity != "" || c.HeaderTimeoutSeconds != 0 || (c.AuthMode != "" && c.AuthMode != "api-key") {
		return ErrPluginProviderConfig
	}
	if !pluginText(c.APIKey, 16<<10, true) || !pluginText(c.BaseURL, 4096, true) || c.MaxTokens < 0 || c.MaxTokens > 65536 || c.ContextWindow < 0 || (c.ContextWindow > 0 && c.ContextWindow < 1024) || c.ContextWindow > 262144 || math.IsNaN(c.Temperature) || math.IsInf(c.Temperature, 0) || c.Temperature < 0 || c.Temperature > 2 {
		return ErrPluginProviderConfig
	}
	if c.BaseURL != "" {
		u, err := url.Parse(c.BaseURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Fragment != "" || strings.ContainsAny(c.BaseURL, "\r\n") {
			return ErrPluginProviderConfig
		}
	}
	return validatePluginHeaders(c.Headers)
}

func pluginText(value string, limit int, empty bool) bool {
	return (empty || value != "") && len(value) <= limit && utf8.ValidString(value) && !strings.ContainsRune(value, 0)
}

func validatePluginHeaders(headers map[string]string) error {
	if len(headers) > 32 {
		return ErrPluginProviderConfig
	}
	seen := make(map[string]bool, len(headers))
	size := 0
	for name, value := range headers {
		key := strings.ToLower(name)
		size += len(name) + len(value)
		if !pluginHeaderName.MatchString(name) || seen[key] || !pluginText(value, 4096, true) || strings.ContainsAny(value, "\r\n") || size > 16<<10 {
			return ErrPluginProviderConfig
		}
		switch key {
		case "host", "content-length", "connection", "transfer-encoding", "upgrade", "proxy-authorization":
			return ErrPluginProviderConfig
		}
		seen[key] = true
	}
	return nil
}

// selectedPluginConfig pins the declared image capability; a caller claim never widens it.
func selectedPluginConfig(c ai.ProviderConfig, supportsImages bool) ai.ProviderConfig {
	images := supportsImages
	headers := make(map[string]string, len(c.Headers))
	for key, value := range c.Headers {
		headers[key] = value
	}
	return ai.ProviderConfig{ID: c.ID, Type: c.Type, Name: c.Name, AuthMode: c.AuthMode, APIKey: c.APIKey, BaseURL: c.BaseURL, Model: c.Model, Headers: headers, MaxTokens: c.MaxTokens, ContextWindow: c.ContextWindow, SupportsImages: &images, Temperature: c.Temperature}
}
