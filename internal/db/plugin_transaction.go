package db

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
)

const pluginDatabaseMaxTransactionID = 128

// PluginTransaction is a host-managed transaction on one plugin database session.
// Every call carries the host-issued transaction id; plugin code never chooses it.
// Calls are serialized because a SQL transaction is a single logical connection.
type PluginTransaction struct {
	db       *PluginDatabase
	id       string
	mu       sync.Mutex
	finished bool
}

var _ TransactionExecer = (*PluginTransaction)(nil)
var _ StatementQueryExecer = (*PluginTransaction)(nil)
var _ StatementExecerDiscarter = (*PluginTransaction)(nil)

// OpenTransactionExecer starts an explicit transaction only for a writable source.
// A malformed or missing plugin transaction id fails closed and allocates no handle.
func (p *PluginDatabase) OpenTransactionExecer(ctx context.Context) (TransactionExecer, error) {
	if ctx == nil {
		return nil, errors.New("plugin database context is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if p.source.ReadOnly {
		return nil, ErrPluginDatabaseReadOnly
	}
	response, err := p.call(ctx, pluginDatabaseRequest{ProtocolVersion: 2, Operation: "begin"}, false)
	if err != nil {
		return nil, err
	}
	id, err := decodePluginTransactionID(response)
	if err != nil {
		return nil, p.checkedResponse(err)
	}
	return &PluginTransaction{db: p, id: id}, nil
}

func decodePluginTransactionID(payload json.RawMessage) (string, error) {
	envelope, err := pluginDatabaseEnvelope(payload, "ok", "transactionId")
	if err != nil {
		return "", err
	}
	var ok bool
	if err := decodePluginDatabaseValue(envelope["ok"], &ok); err != nil || !ok {
		return "", ErrPluginDatabaseProtocol
	}
	var id string
	if err := decodePluginDatabaseValue(envelope["transactionId"], &id); err != nil || !validPluginDatabaseText(id, pluginDatabaseMaxTransactionID, true) {
		return "", ErrPluginDatabaseProtocol
	}
	return id, nil
}

func (t *PluginTransaction) active() error {
	if t == nil || t.finished {
		return errors.New("plugin transaction is already finished")
	}
	return nil
}

func (t *PluginTransaction) call(ctx context.Context, operation, query string) (json.RawMessage, error) {
	if ctx == nil {
		return nil, errors.New("plugin database context is required")
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if err := t.active(); err != nil {
		return nil, err
	}
	return t.db.call(ctx, pluginDatabaseRequest{ProtocolVersion: 2, Operation: operation, Query: query, TransactionID: t.id}, false)
}

func (t *PluginTransaction) QueryContext(ctx context.Context, query string) ([]map[string]interface{}, []string, error) {
	if !validPluginDatabaseText(query, pluginDatabaseMaxQuery, true) {
		return nil, nil, errors.New("plugin database query exceeds limits")
	}
	response, err := t.call(ctx, "query", query)
	if err != nil {
		return nil, nil, err
	}
	rows, fields, err := decodePluginQuery(response)
	if err != nil {
		return nil, nil, err
	}
	if err := consumePluginDatabaseBudget(ctx, rows); err != nil {
		return nil, nil, err
	}
	return rows, fields, nil
}

func (t *PluginTransaction) Query(query string) ([]map[string]interface{}, []string, error) {
	return t.QueryContext(metadataContextFor(t.db), query)
}

func (t *PluginTransaction) ExecContext(ctx context.Context, query string) (int64, error) {
	if !validPluginDatabaseText(query, pluginDatabaseMaxQuery, true) {
		return 0, errors.New("plugin database query exceeds limits")
	}
	response, err := t.call(ctx, "exec", query)
	if err != nil {
		return 0, err
	}
	return decodePluginExecResult(response)
}

func (t *PluginTransaction) Exec(query string) (int64, error) {
	return t.ExecContext(metadataContextFor(t.db), query)
}

func (t *PluginTransaction) finish(ctx context.Context, operation string) error {
	if ctx == nil {
		return errors.New("plugin database context is required")
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.finished {
		return nil
	}
	t.finished = true
	response, err := t.db.call(ctx, pluginDatabaseRequest{ProtocolVersion: 2, Operation: operation, TransactionID: t.id}, false)
	if err != nil {
		return err
	}
	return decodePluginDatabaseOK(response)
}

// Commit finishes the transaction. The handle is never reused, even on an error.
func (t *PluginTransaction) Commit() error {
	if t == nil {
		return nil
	}
	return t.finish(context.Background(), "commit")
}

// Rollback finishes the transaction. A repeated rollback is a no-op.
func (t *PluginTransaction) Rollback() error {
	if t == nil {
		return nil
	}
	return t.finish(context.Background(), "rollback")
}

// Close rolls back an unfinished transaction and is idempotent.
func (t *PluginTransaction) Close() error {
	if t == nil {
		return nil
	}
	return t.Rollback()
}

// Discard rolls back and releases the handle; it does not kill the plugin session.
func (t *PluginTransaction) Discard() error { return t.Close() }
