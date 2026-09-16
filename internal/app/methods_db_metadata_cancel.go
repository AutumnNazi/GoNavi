package app

import (
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
)

const metadataCancellationSlowThreshold = 250 * time.Millisecond

func (a *App) runMetadataWithCancelID(
	config connection.ConnectionConfig,
	queryID string,
	operation func(*App) connection.QueryResult,
) connection.QueryResult {
	normalizedQueryID := strings.TrimSpace(queryID)
	if normalizedQueryID == "" {
		normalizedQueryID = generateQueryID()
	}
	ctx, cancelContext := newQueryExecutionContext(config)
	var completed atomic.Bool
	var cancellationOnce sync.Once
	cancel := func() {
		cancellationOnce.Do(func() {
			time.AfterFunc(metadataCancellationSlowThreshold, func() {
				if !completed.Load() {
					logger.Warnf(
						"元数据请求取消后底层操作仍未返回：queryID=%s type=%s",
						normalizedQueryID,
						strings.TrimSpace(config.Type),
					)
				}
			})
		})
		cancelContext()
	}
	cleanup := a.registerRunningQuery(
		normalizedQueryID,
		cancel,
		true,
		optionalDriverTypeForConnectionConfig(config),
	)
	defer cleanup()
	defer cancelContext()
	result := a.runWebMetadataWithContext(ctx, operation)
	completed.Store(true)
	return result
}

func (a *App) DBGetDatabasesWithCancel(
	config connection.ConnectionConfig,
	queryID string,
) connection.QueryResult {
	return a.runMetadataWithCancelID(config, queryID, func(session *App) connection.QueryResult {
		return session.DBGetDatabases(config)
	})
}

func (a *App) DBGetTablesWithCancel(
	config connection.ConnectionConfig,
	dbName string,
	queryID string,
) connection.QueryResult {
	return a.runMetadataWithCancelID(config, queryID, func(session *App) connection.QueryResult {
		return session.DBGetTables(config, dbName)
	})
}

func (a *App) DBGetAllColumnsWithCancel(
	config connection.ConnectionConfig,
	dbName string,
	queryID string,
) connection.QueryResult {
	return a.runMetadataWithCancelID(config, queryID, func(session *App) connection.QueryResult {
		return session.DBGetAllColumns(config, dbName)
	})
}

func (a *App) DBGetColumnsWithCancel(
	config connection.ConnectionConfig,
	dbName string,
	tableName string,
	queryID string,
) connection.QueryResult {
	return a.runMetadataWithCancelID(config, queryID, func(session *App) connection.QueryResult {
		return session.DBGetColumns(config, dbName, tableName)
	})
}

func (a *App) DBShowCreateTableWithCancel(
	config connection.ConnectionConfig,
	dbName string,
	tableName string,
	queryID string,
) connection.QueryResult {
	return a.runMetadataWithCancelID(config, queryID, func(session *App) connection.QueryResult {
		return session.DBShowCreateTable(config, dbName, tableName)
	})
}
