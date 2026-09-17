package app

import (
	"context"
	"time"

	"GoNavi-Wails/internal/connection"
)

func newQueryExecutionContext(config connection.ConnectionConfig) (context.Context, context.CancelFunc) {
	return newQueryExecutionContextWithParent(context.Background(), config)
}

// newQueryExecutionContextWithParent keeps query cancellation linked to the
// caller while deliberately keeping connection establishment timeout separate
// from the query deadline.
func newQueryExecutionContextWithParent(parent context.Context, config connection.ConnectionConfig) (context.Context, context.CancelFunc) {
	if parent == nil {
		parent = context.Background()
	}
	if config.QueryTimeout > 0 {
		return context.WithTimeout(parent, time.Duration(config.QueryTimeout)*time.Second)
	}

	// Connection timeout is only for establishing the connection. Do not reuse it
	// as a query deadline; long-running queries remain cancellable via CancelQuery.
	return context.WithCancel(parent)
}
