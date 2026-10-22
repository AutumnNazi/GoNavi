package provider

import (
	"encoding/json"
	"reflect"
	"unicode/utf8"

	"GoNavi-Wails/internal/ai"
)

// Check a lower byte bound before encoding; JSON escaping may expand it by at most six.
// The exact encoded request limit is enforced separately before any RPC.
func pluginRequestTextBudget(req ai.ChatRequest) error {
	bytes := 0
	for _, message := range req.Messages {
		if len(message.ToolCalls) > 64 {
			return ErrPluginProviderConfig
		}
		bytes += len(message.Role) + len(message.Content) + len(message.ReasoningContent) + len(message.ToolCallID)
		for _, call := range message.ToolCalls {
			bytes += len(call.ID) + len(call.Type) + len(call.Function.Name) + len(call.Function.Arguments)
			if bytes > 512<<10 {
				return ErrPluginProviderConfig
			}
		}
		if bytes > 512<<10 {
			return ErrPluginProviderConfig
		}
	}
	for _, tool := range req.Tools {
		bytes += len(tool.Type) + len(tool.Function.Name) + len(tool.Function.Description)
		if bytes > 512<<10 {
			return ErrPluginProviderConfig
		}
	}
	return nil
}

type pluginValueBudget struct{ nodes, bytes int }

func pluginSchema(value any) (json.RawMessage, error) {
	if raw, ok := value.(json.RawMessage); ok {
		if pluginJSON(raw, 512<<10) != nil {
			return nil, ErrPluginProviderConfig
		}
		return append(json.RawMessage(nil), raw...), nil
	}
	budget := pluginValueBudget{}
	if err := budget.visit(reflect.ValueOf(value), 0); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(value)
	if err != nil || pluginJSON(raw, 512<<10) != nil {
		return nil, ErrPluginProviderConfig
	}
	return raw, nil
}
func (b *pluginValueBudget) visit(value reflect.Value, depth int) error {
	if value.IsValid() && value.Kind() == reflect.Interface {
		if value.IsNil() {
			value = reflect.Value{}
		} else {
			return b.visit(value.Elem(), depth)
		}
	}
	b.nodes++
	if depth > 32 || b.nodes > 32768 || b.bytes > 512<<10 {
		return ErrPluginProviderConfig
	}
	if !value.IsValid() {
		return nil
	}
	if value.CanInterface() {
		if raw, ok := value.Interface().(json.RawMessage); ok {
			b.bytes += len(raw)
			if b.bytes > 512<<10 || pluginJSON(raw, 512<<10) != nil {
				return ErrPluginProviderConfig
			}
			return nil
		}
	}
	switch value.Kind() {
	case reflect.Map:
		if value.Type().Key().Kind() != reflect.String || value.Len() > 32768 {
			return ErrPluginProviderConfig
		}
		iter := value.MapRange()
		for iter.Next() {
			if err := b.visit(iter.Key(), depth+1); err != nil {
				return err
			}
			if err := b.visit(iter.Value(), depth+1); err != nil {
				return err
			}
		}
	case reflect.Array, reflect.Slice:
		if value.Len() > 32768 {
			return ErrPluginProviderConfig
		}
		for i := 0; i < value.Len(); i++ {
			if err := b.visit(value.Index(i), depth+1); err != nil {
				return err
			}
		}
	case reflect.String:
		text := value.String()
		b.bytes += len(text)
		if b.bytes > 512<<10 || !utf8.ValidString(text) {
			return ErrPluginProviderConfig
		}
	case reflect.Bool, reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Float32, reflect.Float64:
		b.bytes++
	default:
		return ErrPluginProviderConfig
	}
	if b.bytes > 512<<10 {
		return ErrPluginProviderConfig
	}
	return nil
}
