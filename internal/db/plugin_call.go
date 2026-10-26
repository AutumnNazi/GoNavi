package db

import (
	"context"
	"encoding/json"
	"errors"
)

type pluginDatabaseRequest struct {
	ProtocolVersion int                   `json:"protocolVersion"`
	Operation       string                `json:"operation"`
	SessionID       string                `json:"sessionId"`
	Config          *pluginDatabaseConfig `json:"config,omitempty"`
	Database        string                `json:"database,omitempty"`
	Table           string                `json:"table,omitempty"`
	Query           string                `json:"query,omitempty"`
	TransactionID   string                `json:"transactionId,omitempty"`
}

func (p *PluginDatabase) call(ctx context.Context, request pluginDatabaseRequest, connecting bool) (json.RawMessage, error) {
	if ctx == nil {
		return nil, errors.New("plugin database context is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	callCtx, release, err := p.beginCall(ctx, request.Operation, connecting)
	if err != nil {
		return nil, err
	}
	defer release()
	response, err := p.invoke(callCtx, request)
	if err != nil {
		return nil, err
	}
	if err := callCtx.Err(); err != nil {
		return nil, err
	}
	p.mu.Lock()
	closed := p.state == pluginDatabaseClosed
	p.mu.Unlock()
	if closed {
		return nil, ErrPluginDatabaseClosed
	}
	return response, nil
}

func (p *PluginDatabase) beginCall(ctx context.Context, operation string, connecting bool) (context.Context, func(), error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	expected := pluginDatabaseConnected
	if connecting {
		expected = pluginDatabaseConnecting
	}
	if p.state == pluginDatabaseClosed {
		return nil, nil, ErrPluginDatabaseClosed
	}
	if p.state != expected {
		return nil, nil, errors.New("plugin database is not connected")
	}
	if len(p.pending) >= pluginDatabaseMaxCalls {
		return nil, nil, errors.New("plugin database request limit reached")
	}
	timeout := p.queryTimeout
	if operation == "connect" || operation == "ping" {
		timeout = p.connectTimeout
	}
	var callCtx context.Context
	var cancel context.CancelFunc
	if timeout > 0 {
		callCtx, cancel = context.WithTimeout(ctx, timeout)
	} else {
		callCtx, cancel = context.WithCancel(ctx)
	}
	p.nextCall++
	id := p.nextCall
	p.pending[id] = cancel
	return callCtx, func() { cancel(); p.mu.Lock(); delete(p.pending, id); p.mu.Unlock() }, nil
}

func (p *PluginDatabase) invoke(ctx context.Context, request pluginDatabaseRequest) (json.RawMessage, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !p.runtimeCurrent() {
		return nil, ErrPluginDatabaseUnavailable
	}
	if request.ProtocolVersion == 0 {
		request.ProtocolVersion = 1
	}
	request.SessionID = p.sessionID
	arguments, err := json.Marshal(request)
	if err != nil || len(arguments) > pluginDatabaseMaxJSON {
		return nil, errors.New("plugin database request exceeds limits")
	}
	result, err := p.runtime.InvokeDataSourceGeneration(ctx, p.pluginID, p.generation, p.source.ID, arguments)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, pluginDatabaseFailure(request.Operation, err)
	}
	if !p.runtimeCurrent() {
		return nil, ErrPluginDatabaseUnavailable
	}
	if len(result) == 0 || len(result) > pluginDatabaseMaxJSON {
		return nil, ErrPluginDatabaseProtocol
	}
	return result, nil
}
