package main

import (
	"bytes"
	"encoding/json"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

type streamState struct {
	finishReason string
	done         bool
	usage        *plugin.AIProviderUsage
	tools        toolAccumulator
}

func (s *streamState) accept(data []byte, emit plugin.AIProviderEmit) error {
	if s.done {
		return failure("generation_failed")
	}
	if bytes.Equal(data, []byte("[DONE]")) {
		if s.finishReason == "" {
			return failure("generation_failed")
		}
		s.done = true
		return nil
	}
	if err := validateWireJSON(data); err != nil {
		return err
	}
	frame, err := wireObject(data)
	if err != nil {
		return err
	}
	if _, exists := frame["error"]; exists {
		return failure("generation_failed")
	}
	var choices []json.RawMessage
	if raw := frame["choices"]; len(raw) == 0 || isNull(raw) || json.Unmarshal(raw, &choices) != nil || len(choices) > 1 {
		return failure("generation_failed")
	}
	hasUsage := len(frame["usage"]) > 0 && !isNull(frame["usage"])
	if hasUsage {
		if s.usage != nil {
			return failure("generation_failed")
		}
		s.usage, err = parseUsage(frame["usage"])
		if err != nil {
			return err
		}
	}
	if len(choices) == 0 {
		if !hasUsage {
			return failure("generation_failed")
		}
		return nil
	}
	if s.finishReason != "" {
		return failure("generation_failed")
	}
	return s.choice(choices[0], emit)
}

func (s *streamState) choice(raw json.RawMessage, emit plugin.AIProviderEmit) error {
	choice, err := wireObject(raw)
	if err != nil {
		return err
	}
	index, err := wireCount(choice["index"])
	if err != nil || index != 0 {
		return failure("generation_failed")
	}
	finish, err := wireString(choice["finish_reason"])
	if err != nil {
		return err
	}
	if finish != "" && finish != "stop" && finish != "tool_calls" && finish != "length" {
		return failure("generation_failed")
	}
	if value, exists := choice["finish_reason"]; exists && !isNull(value) && finish == "" {
		return failure("generation_failed")
	}
	delta, err := s.delta(choice["delta"], finish != "")
	if err != nil {
		return err
	}
	if delta.Content != "" || delta.ReasoningContent != "" {
		if err := emit(delta); err != nil {
			return err
		}
	}
	s.finishReason = finish
	return nil
}

func (s *streamState) delta(raw json.RawMessage, finishing bool) (plugin.AIProviderDelta, error) {
	var result plugin.AIProviderDelta
	if len(raw) == 0 || isNull(raw) {
		if finishing {
			return result, nil
		}
		return result, failure("generation_failed")
	}
	delta, err := wireObject(raw)
	if err != nil {
		return result, err
	}
	result.Content, err = wireString(delta["content"])
	if err != nil {
		return result, err
	}
	result.ReasoningContent, err = wireString(delta["reasoning_content"])
	if err != nil {
		return result, err
	}
	if rawTools := delta["tool_calls"]; len(rawTools) > 0 && !isNull(rawTools) {
		if err := s.tools.add(rawTools); err != nil {
			return result, err
		}
	}
	return result, nil
}

func (s *streamState) completion() (plugin.AIProviderCompletion, error) {
	if !s.done || s.finishReason == "" {
		return plugin.AIProviderCompletion{}, failure("generation_failed")
	}
	calls, err := s.tools.complete()
	if err != nil {
		return plugin.AIProviderCompletion{}, err
	}
	if (s.finishReason == "tool_calls" && len(calls) == 0) || (s.finishReason == "stop" && len(calls) > 0) {
		return plugin.AIProviderCompletion{}, failure("generation_failed")
	}
	return plugin.AIProviderCompletion{FinishReason: s.finishReason, ToolCalls: calls, Usage: s.usage}, nil
}

func parseUsage(raw json.RawMessage) (*plugin.AIProviderUsage, error) {
	object, err := wireObject(raw)
	if err != nil {
		return nil, err
	}
	usage := &plugin.AIProviderUsage{}
	for _, field := range []struct {
		name   string
		target *int64
	}{
		{"prompt_tokens", &usage.PromptTokens},
		{"completion_tokens", &usage.CompletionTokens},
		{"total_tokens", &usage.TotalTokens},
	} {
		*field.target, err = wireCount(object[field.name])
		if err != nil {
			return nil, err
		}
	}
	if details, exists := object["prompt_tokens_details"]; exists {
		parsed, err := wireObject(details)
		if err != nil {
			return nil, err
		}
		if cached, exists := parsed["cached_tokens"]; exists {
			count, err := wireCount(cached)
			if err != nil {
				return nil, err
			}
			usage.CachedTokens = &count
		}
	}
	return usage, nil
}
