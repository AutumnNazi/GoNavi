package provider

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"sync"
	"time"

	"GoNavi-Wails/internal/ai"
)

// ChatStream delivers validated deltas synchronously and never replays uncertain work.
// A blocked callback delays return, but context cancellation still aborts its upstream work.
func (p *pluginProvider) ChatStream(ctx context.Context, request ai.ChatRequest, callback func(ai.StreamChunk)) error {
	if ctx == nil {
		return ErrPluginProviderConfig
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if callback == nil {
		return ErrPluginProviderConfig
	}
	if err := p.Validate(); err != nil {
		return err
	}
	req, offered, err := p.prepareRequest(request)
	if err != nil {
		return err
	}
	if err = p.check(ctx); err != nil {
		return pluginCallError(ctx, err)
	}
	random := make([]byte, 32)
	if _, err = rand.Read(random); err != nil {
		return ErrPluginProviderOperation
	}
	id := base64.RawURLEncoding.EncodeToString(random)
	lifetime, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	cleanup := p.completionCleanup(ctx, id)
	stop := context.AfterFunc(lifetime, cleanup)
	defer func() { stop(); cleanup() }()
	envelope := pluginRequestEnvelope{ProtocolVersion: 1, Operation: "start", ProviderID: p.pin.ProviderID, RequestID: id, Config: &pluginSelectedConfig{BaseURL: p.config.BaseURL, APIKey: p.config.APIKey, Model: p.config.Model, Headers: p.config.Headers}, Request: &req}
	raw, err := p.rpc(lifetime, envelope, 5*time.Second)
	if err != nil {
		return pluginCallError(ctx, err)
	}
	var ack struct {
		Accepted bool `json:"accepted"`
	}
	if pluginJSON(raw, 1024) != nil || pluginDecodeObject(raw, &ack) != nil || !ack.Accepted {
		return ErrPluginProviderResponse
	}
	state := pluginCompletionState{offered: offered, supportsTools: p.declaration.SupportsTools}
	for {
		raw, err = p.rpc(lifetime, pluginRequestEnvelope{ProtocolVersion: 1, Operation: "pull", ProviderID: p.pin.ProviderID, RequestID: id}, 5*time.Second)
		if err != nil {
			return pluginCallError(ctx, err)
		}
		events, err := state.batch(raw)
		if err != nil {
			return err
		}
		for _, event := range events {
			if err = p.live(lifetime); err != nil {
				return pluginCallError(ctx, err)
			}
			if event.Type == "error" {
				if event.Code == "limit_exceeded" {
					return ErrPluginProviderLimit
				}
				return ErrPluginProviderOperation
			}
			callback(ai.StreamChunk{Content: event.Content, ReasoningContent: event.ReasoningContent, Done: event.Type == "done", ToolCalls: event.ToolCalls, Usage: event.Usage})
			if err = p.live(lifetime); err != nil {
				return pluginCallError(ctx, err)
			}
			if event.Type == "done" {
				if event.FinishReason == "length" && request.ReportOutputLimit {
					return &ai.OutputLimitError{}
				}
				return nil
			}
		}
		if len(events) == 0 {
			if err = waitPluginPull(lifetime); err != nil {
				return pluginCallError(ctx, err)
			}
		}
	}
}

func (p *pluginProvider) live(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return p.check(ctx)
}
func (p *pluginProvider) rpc(ctx context.Context, request pluginRequestEnvelope, budget time.Duration) (json.RawMessage, error) {
	if err := p.live(ctx); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(request)
	if err != nil || pluginJSON(raw, pluginRequestBytes(p.declaration.SupportsImages)) != nil {
		return nil, ErrPluginProviderConfig
	}
	call, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	result, err := p.invoke(call, raw)
	if err != nil {
		return nil, err
	}
	if err = p.live(ctx); err != nil {
		return nil, err
	}
	return result, nil
}
func (p *pluginProvider) completionCleanup(ctx context.Context, id string) func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			// Cleanup must run even while the synchronous consumer callback is blocked.
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 250*time.Millisecond)
			defer cancel()
			request := pluginRequestEnvelope{ProtocolVersion: 1, Operation: "cancel", ProviderID: p.pin.ProviderID, RequestID: id}
			raw, err := json.Marshal(request)
			if err != nil {
				return
			}
			// No fresh binding or policy callback: only cancel this already captured generation.
			if _, err = p.invoke(cleanup, raw); err != nil {
				return
			}
		})
	}
}
func pluginCallError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	switch err {
	case ErrPluginProviderUnavailable, ErrPluginProviderConfig, ErrPluginProviderResponse, ErrPluginProviderLimit:
		return err
	}
	return ErrPluginProviderOperation
}
func waitPluginPull(ctx context.Context) error {
	timer := time.NewTimer(20 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
