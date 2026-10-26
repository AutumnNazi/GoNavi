package main

import (
	"bytes"
	"encoding/json"
	"strings"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

const (
	maxToolCalls     = 64
	maxToolTextBytes = 128
	maxArgumentBytes = 32 << 10
	maxToolJSONBytes = 48 << 10
)

type toolFragment struct {
	call      plugin.AIProviderToolCall
	typeKnown bool
}

type toolAccumulator struct {
	fragments [maxToolCalls]*toolFragment
	textBytes int
}

func (a *toolAccumulator) add(raw json.RawMessage) error {
	var fragments []json.RawMessage
	if json.Unmarshal(raw, &fragments) != nil || fragments == nil {
		return failure("generation_failed")
	}
	if len(fragments) > maxToolCalls {
		return failure("limit_exceeded")
	}
	for _, rawFragment := range fragments {
		if err := a.addFragment(rawFragment); err != nil {
			return err
		}
	}
	return nil
}

func (a *toolAccumulator) addFragment(raw json.RawMessage) error {
	object, err := wireObject(raw)
	if err != nil {
		return err
	}
	index, err := wireCount(object["index"])
	if err != nil {
		return err
	}
	if index >= maxToolCalls {
		return failure("limit_exceeded")
	}
	fragment := a.fragments[index]
	if fragment == nil {
		fragment = &toolFragment{}
		a.fragments[index] = fragment
	}
	if err := a.appendText(&fragment.call.ID, object["id"], maxToolTextBytes); err != nil {
		return err
	}
	kind, err := wireString(object["type"])
	if err != nil || (kind != "" && kind != "function") {
		return failure("generation_failed")
	}
	if kind == "function" {
		fragment.typeKnown = true
		fragment.call.Type = kind
	}
	function, exists := object["function"]
	if !exists {
		return nil
	}
	fields, err := wireObject(function)
	if err != nil {
		return err
	}
	if err := a.appendText(&fragment.call.Function.Name, fields["name"], maxToolTextBytes); err != nil {
		return err
	}
	return a.appendText(&fragment.call.Function.Arguments, fields["arguments"], maxArgumentBytes)
}

func (a *toolAccumulator) appendText(target *string, raw json.RawMessage, limit int) error {
	value, err := wireString(raw)
	if err != nil {
		return err
	}
	if len(*target)+len(value) > limit || a.textBytes+len(value) > maxToolJSONBytes {
		return failure("limit_exceeded")
	}
	*target += value
	a.textBytes += len(value)
	return nil
}

func (a *toolAccumulator) complete() ([]plugin.AIProviderToolCall, error) {
	var calls []plugin.AIProviderToolCall
	ids := make(map[string]bool)
	for _, fragment := range a.fragments {
		if fragment == nil {
			continue
		}
		call := fragment.call
		if !fragment.typeKnown || strings.TrimSpace(call.ID) == "" || strings.TrimSpace(call.Function.Name) == "" || strings.ContainsRune(call.ID+call.Function.Name, 0) || ids[call.ID] {
			return nil, failure("generation_failed")
		}
		arguments := bytes.TrimSpace([]byte(call.Function.Arguments))
		if len(arguments) == 0 || arguments[0] != '{' {
			return nil, failure("generation_failed")
		}
		if err := validateWireJSON(arguments); err != nil {
			return nil, err
		}
		ids[call.ID] = true
		calls = append(calls, call)
	}
	encoded, err := json.Marshal(calls)
	if err != nil {
		return nil, failure("generation_failed")
	}
	if len(encoded) > maxToolJSONBytes {
		return nil, failure("limit_exceeded")
	}
	return calls, nil
}
