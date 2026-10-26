package db

import (
	"context"
	"encoding/json"
	"errors"
)

// ExecContext runs one mutation through a writable plugin generation. Read-only
// declarations fail before the plugin is contacted. Host protection is enforced
// by the application layer; this method is the last declaration-level fence.
func (p *PluginDatabase) ExecContext(ctx context.Context, query string) (int64, error) {
	if ctx == nil {
		return 0, errors.New("plugin database context is required")
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	if p.source.ReadOnly {
		return 0, ErrPluginDatabaseReadOnly
	}
	if !validPluginDatabaseText(query, pluginDatabaseMaxQuery, true) {
		return 0, errors.New("plugin database query exceeds limits")
	}
	response, err := p.call(ctx, pluginDatabaseRequest{ProtocolVersion: 2, Operation: "exec", Query: query}, false)
	if err != nil {
		return 0, err
	}
	rows, err := decodePluginExecResult(response)
	if err != nil {
		return 0, p.checkedResponse(err)
	}
	if err := p.finishRead(ctx); err != nil {
		return 0, err
	}
	return rows, nil
}

// Exec runs a mutation without a caller deadline, matching db.Database.
func (p *PluginDatabase) Exec(query string) (int64, error) {
	return p.ExecContext(metadataContextFor(p), query)
}

func decodePluginExecResult(payload json.RawMessage) (int64, error) {
	envelope, err := pluginDatabaseEnvelope(payload, "ok", "rowsAffected")
	if err != nil {
		return 0, err
	}
	var ok bool
	if err := decodePluginDatabaseValue(envelope["ok"], &ok); err != nil || !ok {
		return 0, ErrPluginDatabaseProtocol
	}
	var rows int64
	if err := decodePluginDatabaseValue(envelope["rowsAffected"], &rows); err != nil || rows < 0 {
		return 0, ErrPluginDatabaseProtocol
	}
	return rows, nil
}
