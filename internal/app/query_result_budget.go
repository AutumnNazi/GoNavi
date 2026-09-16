package app

import (
	"context"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

const (
	queryEditorSafeMaxRows       = 50_000
	queryEditorSafeMaxTotalBytes = 24 << 20
	queryEditorSafeMaxFieldBytes = 1 << 20
)

// QueryResultBudgetOptions defines the desktop query editor's server-side result limits.
type QueryResultBudgetOptions struct {
	MaxRowsPerResult int   `json:"maxRowsPerResult,omitempty"`
	MaxTotalRows     int   `json:"maxTotalRows,omitempty"`
	MaxTotalBytes    int64 `json:"maxTotalBytes,omitempty"`
	MaxFieldBytes    int   `json:"maxFieldBytes,omitempty"`
}

func normalizeQueryResultBudgetOptions(options QueryResultBudgetOptions) db.RowBudgetOptions {
	maxRowsPerResult := options.MaxRowsPerResult
	if maxRowsPerResult <= 0 || maxRowsPerResult > queryEditorSafeMaxRows {
		maxRowsPerResult = queryEditorSafeMaxRows
	}
	maxTotalRows := options.MaxTotalRows
	if maxTotalRows <= 0 || maxTotalRows > queryEditorSafeMaxRows {
		maxTotalRows = maxRowsPerResult
	}
	maxTotalBytes := options.MaxTotalBytes
	if maxTotalBytes <= 0 || maxTotalBytes > queryEditorSafeMaxTotalBytes {
		maxTotalBytes = queryEditorSafeMaxTotalBytes
	}
	maxFieldBytes := options.MaxFieldBytes
	if maxFieldBytes <= 0 || maxFieldBytes > queryEditorSafeMaxFieldBytes {
		maxFieldBytes = queryEditorSafeMaxFieldBytes
	}
	return db.RowBudgetOptions{
		MaxRowsPerResult: maxRowsPerResult,
		MaxTotalRows:     maxTotalRows,
		MaxTotalBytes:    maxTotalBytes,
		MaxFieldBytes:    maxFieldBytes,
	}
}

// DBQueryMultiWithOptions executes a desktop query with an enforced scan budget.
func (a *App) DBQueryMultiWithOptions(
	config connection.ConnectionConfig,
	dbName string,
	query string,
	queryID string,
	options QueryResultBudgetOptions,
) connection.QueryResult {
	budget := normalizeQueryResultBudgetOptions(options)
	return a.dbQueryMulti(config, dbName, query, queryID, dbQueryMultiAuditOptions{
		auditAll:     strings.TrimSpace(queryID) != "" || a.webRuntime,
		auditWrites:  true,
		source:       "query_editor",
		ResultBudget: &budget,
	})
}

// DBQueryMultiTransactionalWithOptions starts a managed transaction with an enforced result budget.
func (a *App) DBQueryMultiTransactionalWithOptions(
	config connection.ConnectionConfig,
	dbName string,
	query string,
	queryID string,
	options QueryResultBudgetOptions,
) connection.QueryResult {
	budget := normalizeQueryResultBudgetOptions(options)
	return a.dbQueryMultiTransactional(config, dbName, query, queryID, &budget)
}

// DBQueryMultiInTransactionWithOptions runs a follow-up managed-transaction query with a result budget.
func (a *App) DBQueryMultiInTransactionWithOptions(
	transactionID string,
	query string,
	queryID string,
	options QueryResultBudgetOptions,
) connection.QueryResult {
	budget := normalizeQueryResultBudgetOptions(options)
	return a.dbQueryMultiInTransaction(transactionID, query, queryID, &budget)
}

func bindQueryResultBudget(
	ctx context.Context,
	options dbQueryMultiAuditOptions,
) (context.Context, *db.RowBudget) {
	var budget *db.RowBudget
	if options.ResultBudget != nil {
		budget = db.NewRowBudgetWithOptions(*options.ResultBudget)
	} else if options.RowBudget > 0 {
		budget = db.NewRowBudget(options.RowBudget)
	}
	return db.ContextWithRowBudget(ctx, budget), budget
}

func valueOrZero[T any](value *T) T {
	if value == nil {
		var zero T
		return zero
	}
	return *value
}
