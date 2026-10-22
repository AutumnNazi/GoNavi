package db

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/plugin"
)

// Connect uses the metadata request context when the instance is isolated/bound.
func (p *PluginDatabase) Connect(config connection.ConnectionConfig) error {
	return p.ConnectContext(metadataContextFor(p), config)
}

// ConnectContext sends only the selected connection's explicitly projected fields.
// Any uncertain dispatched connect permanently closes this session; never replay it.
func (p *PluginDatabase) ConnectContext(ctx context.Context, config connection.ConnectionConfig) error {
	if ctx == nil {
		return errors.New("plugin database context is required")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	projected, err := p.projectConfig(config)
	if err != nil {
		return err
	}
	p.mu.Lock()
	if p.state != pluginDatabaseNew {
		p.mu.Unlock()
		return errors.New("plugin database session cannot reconnect")
	}
	p.state = pluginDatabaseConnecting
	p.connectTimeout = getConnectTimeout(config)
	p.queryTimeout = time.Duration(config.QueryTimeout) * time.Second
	p.mu.Unlock()
	response, err := p.call(ctx, pluginDatabaseRequest{Operation: "connect", Config: &projected}, true)
	if err == nil {
		err = decodePluginDatabaseOK(response)
	}
	if err != nil {
		return errors.Join(err, p.Close())
	}
	p.mu.Lock()
	if p.state == pluginDatabaseClosed {
		p.mu.Unlock()
		return ErrPluginDatabaseClosed
	}
	p.state = pluginDatabaseConnected
	p.mu.Unlock()
	return nil
}

// Close immediately invalidates the local session and cancels every outstanding
// call. It never waits for those calls; one remote cleanup gets at most 250ms.
func (p *PluginDatabase) Close() error { return p.CloseContext(context.Background()) }

// CloseContext shares a host shutdown budget while always canceling locally.
// Remote cleanup is capped at 250ms and skipped once the caller budget expires.
func (p *PluginDatabase) CloseContext(ctx context.Context) error {
	p.mu.Lock()
	if p.state == pluginDatabaseClosed {
		p.mu.Unlock()
		return nil
	}
	opened := p.state != pluginDatabaseNew
	p.state = pluginDatabaseClosed
	for _, cancel := range p.pending {
		cancel()
	}
	p.mu.Unlock()
	ClearMetadataContext(p)
	var err error
	if ctx == nil {
		err = errors.New("plugin database context is required")
	} else {
		err = ctx.Err()
	}
	if opened && err == nil {
		closeCtx, cancel := context.WithTimeout(ctx, pluginDatabaseCloseTimeout)
		if p.runtimeCurrent() {
			response, callErr := p.invoke(closeCtx, pluginDatabaseRequest{Operation: "close"})
			err = callErr
			if pluginDatabaseRuntimeGone(err) {
				err = nil
			} else if err == nil {
				err = decodePluginDatabaseOK(response)
			}
		}
		cancel()
	}
	p.mu.Lock()
	p.closeErr = err
	close(p.closeDone)
	p.mu.Unlock()
	return err
}

func pluginDatabaseRuntimeGone(err error) bool {
	// Persisted running state can lag owner shutdown; these typed admission
	// failures mean the generation cannot own an addressable session anymore.
	return errors.Is(err, ErrPluginDatabaseUnavailable) || errors.Is(err, plugin.ErrDisabled) || errors.Is(err, plugin.ErrClosed) || errors.Is(err, plugin.ErrNotFound)
}

// WaitClosed waits for an already-initiated concurrent Close, without changing
// its deadline or replaying cleanup. Ordinary eviction need not call this method.
func (p *PluginDatabase) WaitClosed(ctx context.Context) error {
	if ctx == nil {
		return errors.New("plugin database context is required")
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-p.closeDone:
		p.mu.Lock()
		err := p.closeErr
		p.mu.Unlock()
		return err
	}
}

// Ping uses the current metadata request context and generation-bound session.
func (p *PluginDatabase) Ping() error { return p.PingContext(metadataContextFor(p)) }

// PingContext allows shared cached connections to honor each caller cancellation.
func (p *PluginDatabase) PingContext(ctx context.Context) error {
	response, err := p.call(ctx, pluginDatabaseRequest{Operation: "ping"}, false)
	if err != nil {
		return err
	}
	return p.checkedResponse(decodePluginDatabaseOK(response))
}

func (p *PluginDatabase) checkedResponse(err error) error {
	if err == nil {
		return nil
	}
	return errors.Join(err, p.Close())
}

func decodePluginDatabaseOK(response json.RawMessage) error {
	envelope, err := pluginDatabaseEnvelope(response, "ok")
	if err != nil {
		return err
	}
	var ok bool
	if err := decodePluginDatabaseValue(envelope["ok"], &ok); err != nil || !ok {
		return ErrPluginDatabaseProtocol
	}
	return nil
}
