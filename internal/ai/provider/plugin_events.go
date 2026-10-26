package provider

import (
	"bytes"
	"encoding/json"

	"GoNavi-Wails/internal/ai"
)

type pluginCompletionEvent struct {
	Sequence         uint64         `json:"sequence"`
	Type             string         `json:"type"`
	Content          string         `json:"content,omitempty"`
	ReasoningContent string         `json:"reasoningContent,omitempty"`
	FinishReason     string         `json:"finishReason,omitempty"`
	ToolCalls        []ai.ToolCall  `json:"toolCalls,omitempty"`
	Usage            *ai.TokenUsage `json:"usage,omitempty"`
	Code             string         `json:"code,omitempty"`
}
type pluginPullResult struct {
	Events []json.RawMessage `json:"events"`
}
type pluginCompletionState struct {
	sequence      uint64
	bytes         int
	terminal      bool
	offered       map[string]bool
	supportsTools bool
}

func (s *pluginCompletionState) batch(raw []byte) ([]pluginCompletionEvent, error) {
	if pluginJSON(raw, 128<<10) != nil {
		return nil, ErrPluginProviderResponse
	}
	var result pluginPullResult
	if pluginDecodeObject(raw, &result) != nil || result.Events == nil || len(result.Events) > 16 {
		return nil, ErrPluginProviderResponse
	}
	events := make([]pluginCompletionEvent, 0, len(result.Events))
	// Validate the whole batch before publishing any callback, including trailing events.
	next := *s
	for _, rawEvent := range result.Events {
		if next.terminal || len(rawEvent) > 64<<10 || next.bytes+len(rawEvent) > 8<<20 || next.sequence >= 65536 {
			return nil, ErrPluginProviderLimit
		}
		var event pluginCompletionEvent
		if pluginDecodeObject(rawEvent, &event) != nil || event.Sequence != next.sequence+1 {
			return nil, ErrPluginProviderResponse
		}
		if err := validatePluginEvent(rawEvent, event, next.offered, next.supportsTools); err != nil {
			return nil, err
		}
		next.sequence++
		next.bytes += len(rawEvent)
		next.terminal = event.Type != "delta"
		events = append(events, event)
	}
	*s = next
	return events, nil
}
func validatePluginEvent(raw []byte, e pluginCompletionEvent, offered map[string]bool, tools bool) error {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return ErrPluginProviderResponse
	}
	allowed := map[string]bool{"sequence": true, "type": true}
	switch e.Type {
	case "delta":
		allowed["content"] = true
		allowed["reasoningContent"] = true
		if (e.Content == "" && e.ReasoningContent == "") || !pluginText(e.Content, 64<<10, true) || !pluginText(e.ReasoningContent, 64<<10, true) {
			return ErrPluginProviderResponse
		}
	case "done":
		allowed["finishReason"] = true
		allowed["toolCalls"] = true
		allowed["usage"] = true
		if e.FinishReason != "stop" && e.FinishReason != "tool_calls" && e.FinishReason != "length" {
			return ErrPluginProviderResponse
		}
		if (e.FinishReason == "tool_calls" && len(e.ToolCalls) == 0) || (e.FinishReason == "stop" && len(e.ToolCalls) > 0) || (!tools && len(e.ToolCalls) > 0) || validatePluginToolCalls(e.ToolCalls, offered) != nil {
			return ErrPluginProviderResponse
		}
		if e.Usage != nil {
			if err := validatePluginUsage(fields["usage"], e.Usage); err != nil {
				return err
			}
		}
	case "error":
		allowed["code"] = true
		switch e.Code {
		case "canceled", "deadline", "unsupported", "invalid_request", "generation_failed", "limit_exceeded":
		default:
			return ErrPluginProviderResponse
		}
	default:
		return ErrPluginProviderResponse
	}
	for key, value := range fields {
		if !allowed[key] || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return ErrPluginProviderResponse
		}
	}
	return nil
}
func validatePluginUsage(raw []byte, u *ai.TokenUsage) error {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return ErrPluginProviderResponse
	}
	for _, key := range []string{"promptTokens", "completionTokens", "totalTokens"} {
		if _, ok := fields[key]; !ok {
			return ErrPluginProviderResponse
		}
	}
	for _, value := range []int{u.PromptTokens, u.CompletionTokens, u.TotalTokens} {
		if value < 0 || int64(value) > 1<<53-1 {
			return ErrPluginProviderResponse
		}
	}
	if u.CachedTokens != nil && (*u.CachedTokens < 0 || int64(*u.CachedTokens) > 1<<53-1) {
		return ErrPluginProviderResponse
	}
	return nil
}
