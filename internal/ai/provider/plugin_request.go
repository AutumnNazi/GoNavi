package provider

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"

	"GoNavi-Wails/internal/ai"
)

type pluginSelectedConfig struct {
	BaseURL string            `json:"baseUrl"`
	APIKey  string            `json:"apiKey"`
	Model   string            `json:"model"`
	Headers map[string]string `json:"headers,omitempty"`
}
type pluginRequestEnvelope struct {
	ProtocolVersion int                   `json:"protocolVersion"`
	Operation       string                `json:"operation"`
	ProviderID      string                `json:"providerId"`
	RequestID       string                `json:"requestId"`
	Config          *pluginSelectedConfig `json:"config,omitempty"`
	Request         *ai.ChatRequest       `json:"request,omitempty"`
}

func (p *pluginProvider) prepareRequest(req ai.ChatRequest) (ai.ChatRequest, map[string]bool, error) {
	if len(req.Messages) == 0 || len(req.Messages) > 512 || len(req.Tools) > 128 || (!p.declaration.SupportsTools && len(req.Tools) > 0) || math.IsNaN(req.Temperature) || math.IsInf(req.Temperature, 0) || req.Temperature < 0 || req.Temperature > 2 {
		return req, nil, ErrPluginProviderConfig
	}
	cap := 0
	for _, model := range p.declaration.Models {
		if model.ID == p.config.Model {
			cap = model.MaxOutputTokens
		}
	}
	if p.config.ContextWindow > 0 && p.config.ContextWindow < cap {
		cap = p.config.ContextWindow
	}
	if p.config.MaxTokens > 0 && p.config.MaxTokens < cap {
		cap = p.config.MaxTokens
	}
	if cap == 0 || req.MaxTokens < 0 || req.MaxTokens > cap {
		return req, nil, ErrPluginProviderConfig
	}
	if req.MaxTokens == 0 {
		req.MaxTokens = cap
	}
	if err := pluginRequestTextBudget(req); err != nil {
		return req, nil, err
	}
	if !p.declaration.SupportsImages && pluginMessageHasImages(req.Messages) {
		return req, nil, ErrPluginProviderConfig
	}
	if p.declaration.SupportsImages {
		if _, err := validatePluginImages(req.Messages); err != nil {
			return req, nil, err
		}
	}
	req.Tools = append([]ai.Tool(nil), req.Tools...)
	schemaBytes := 0
	offered := make(map[string]bool, len(req.Tools))
	for i, tool := range req.Tools {
		if tool.Type != "function" || !pluginToolName(tool.Function.Name) || offered[tool.Function.Name] || !pluginText(tool.Function.Description, 32768, true) {
			return req, nil, ErrPluginProviderConfig
		}
		schema, err := pluginSchema(tool.Function.Parameters)
		if err != nil || pluginJSON(schema, 512<<10) != nil || !strings.HasPrefix(strings.TrimSpace(string(schema)), "{") {
			return req, nil, ErrPluginProviderConfig
		}
		schemaBytes += len(schema)
		if schemaBytes > 512<<10 {
			return req, nil, ErrPluginProviderConfig
		}
		req.Tools[i].Function.Parameters = schema
		offered[tool.Function.Name] = true
	}
	for _, message := range req.Messages {
		if !pluginText(message.Content, 512<<10, true) || !pluginText(message.ReasoningContent, 512<<10, true) || !pluginText(message.ToolCallID, 128, true) {
			return req, nil, ErrPluginProviderConfig
		}
		switch message.Role {
		case "system", "user", "assistant", "tool":
		default:
			return req, nil, ErrPluginProviderConfig
		}
		if (message.Role == "tool" && message.ToolCallID == "") || (message.Role != "tool" && message.ToolCallID != "") || (message.Role != "assistant" && len(message.ToolCalls) > 0) {
			return req, nil, ErrPluginProviderConfig
		}
		if len(message.ToolCalls) > 0 && (!p.declaration.SupportsTools || validatePluginToolCalls(message.ToolCalls, nil) != nil) {
			return req, nil, ErrPluginProviderConfig
		}
	}
	raw, err := json.Marshal(req)
	if err != nil || pluginJSON(raw, pluginRequestBytes(p.declaration.SupportsImages)) != nil {
		return req, nil, ErrPluginProviderConfig
	}
	// Snapshot all maps/slices before asynchronous cancellation or caller mutation.
	var copied ai.ChatRequest
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&copied) != nil {
		return req, nil, ErrPluginProviderConfig
	}
	copied.ReportOutputLimit = req.ReportOutputLimit
	return copied, offered, nil
}

func pluginToolName(name string) bool {
	return pluginText(name, 128, false) && strings.TrimSpace(name) == name
}
func validatePluginToolCalls(calls []ai.ToolCall, offered map[string]bool) error {
	if len(calls) > 64 {
		return ErrPluginProviderResponse
	}
	textBytes := 0
	for _, call := range calls {
		textBytes += len(call.ID) + len(call.Type) + len(call.Function.Name) + len(call.Function.Arguments)
		if textBytes > 48<<10 {
			return ErrPluginProviderResponse
		}
	}
	raw, err := json.Marshal(calls)
	if err != nil || len(raw) > 48<<10 {
		return ErrPluginProviderResponse
	}
	seen := make(map[string]bool, len(calls))
	for _, call := range calls {
		if !pluginText(call.ID, 128, false) || seen[call.ID] || call.Type != "function" || !pluginToolName(call.Function.Name) || (offered != nil && !offered[call.Function.Name]) {
			return ErrPluginProviderResponse
		}
		args := []byte(call.Function.Arguments)
		if pluginJSON(args, 32<<10) != nil || !strings.HasPrefix(strings.TrimSpace(string(args)), "{") {
			return ErrPluginProviderResponse
		}
		seen[call.ID] = true
	}
	return nil
}
