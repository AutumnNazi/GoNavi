package provider

import (
	"context"
	"encoding/json"
	"strings"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/plugin"
)

type pluginProvider struct {
	config      ai.ProviderConfig
	declaration plugin.AIProvider
	pin         pluginProviderPin
	check       func(context.Context) error
	invoke      func(context.Context, json.RawMessage) (json.RawMessage, error)
}

var _ Provider = (*pluginProvider)(nil)

func newPluginProvider(f *PluginFactory, m *plugin.Manager, pin pluginProviderPin, c ai.ProviderConfig, d plugin.AIProvider) *pluginProvider {
	d.Models = append([]plugin.AIModel(nil), d.Models...)
	p := &pluginProvider{config: c, declaration: d, pin: pin}
	p.check = func(ctx context.Context) error {
		_, current, err := f.current(ctx, pin, m)
		if err != nil {
			return err
		}
		if current.ID != d.ID || current.Name != d.Name || current.Command != d.Command || current.SupportsTools != d.SupportsTools || current.SupportsImages != d.SupportsImages || len(current.Models) != len(d.Models) {
			return ErrPluginProviderUnavailable
		}
		for i, model := range current.Models {
			if model != d.Models[i] {
				return ErrPluginProviderUnavailable
			}
		}
		return nil
	}
	p.invoke = func(ctx context.Context, args json.RawMessage) (json.RawMessage, error) {
		return m.InvokeAIProviderGeneration(ctx, pin.PluginID, pin.Generation, pin.ProviderID, pin.Digest, args)
	}
	return p
}

// Name identifies the exact plugin namespace without exposing selected credentials.
func (p *pluginProvider) Name() string { return p.config.Type }

// Validate checks syntax only; health requires an explicit model operation.
func (p *pluginProvider) Validate() error { return ValidatePluginConfig(p.config) }

// Chat aggregates the same authenticated completion stream used by ChatStream.
func (p *pluginProvider) Chat(ctx context.Context, req ai.ChatRequest) (*ai.ChatResponse, error) {
	var content, reasoning strings.Builder
	response := &ai.ChatResponse{}
	err := p.ChatStream(ctx, req, func(chunk ai.StreamChunk) {
		content.WriteString(chunk.Content)
		reasoning.WriteString(chunk.ReasoningContent)
		if chunk.Done {
			response.ToolCalls = chunk.ToolCalls
			if chunk.Usage != nil {
				response.TokensUsed = *chunk.Usage
			}
		}
	})
	response.Content = content.String()
	response.ReasoningContent = reasoning.String()
	if err != nil {
		if _, known := err.(*ai.OutputLimitError); !known {
			return nil, err
		}
	}
	return response, err
}
