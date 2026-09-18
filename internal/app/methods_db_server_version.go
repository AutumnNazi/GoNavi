package app

import (
	"context"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/logger"
)

// DBGetServerVersion returns the live server version banner for the current
// connection. Unsupported sources succeed with an empty version so AI SQL
// generation can fall back to a conservative dialect baseline.
func (a *App) DBGetServerVersion(config connection.ConnectionConfig) connection.QueryResult {
	return a.dbGetServerVersion(config)
}

func (a *App) dbGetServerVersion(config connection.ConnectionConfig) connection.QueryResult {
	query, ok := db.ServerVersionQuery(config)
	if !ok {
		return connection.QueryResult{
			Success: true,
			Data:    []map[string]interface{}{},
			Fields:  []string{"version"},
		}
	}

	dbInst, err := a.getDatabase(config)
	if err != nil {
		logger.Error(err, "DBGetServerVersion 获取连接失败：%s", formatConnSummary(config))
		return connection.QueryResult{
			Success: false,
			Message: a.appText("db.backend.error.server_version_failed", map[string]any{"detail": err.Error()}),
		}
	}

	rows, fields, err := dbInst.Query(query)
	if err != nil {
		logger.Error(err, "DBGetServerVersion 查询失败：%s", formatConnSummary(config))
		return connection.QueryResult{
			Success: false,
			Message: a.appText("db.backend.error.server_version_failed", map[string]any{"detail": err.Error()}),
		}
	}

	version := db.SanitizeServerVersion(db.FirstQueryRowValue(rows))
	return connection.QueryResult{
		Success: true,
		Message: version,
		Data:    []map[string]interface{}{{"version": version}},
		Fields:  fieldsOrVersion(fields),
	}
}

func fieldsOrVersion(fields []string) []string {
	if len(fields) > 0 {
		return fields
	}
	return []string{"version"}
}

func (a *App) DBGetServerVersionContext(ctx context.Context, config connection.ConnectionConfig) connection.QueryResult {
	return a.runMetadataWithContext(ctx, func(session *App) connection.QueryResult {
		return session.DBGetServerVersion(config)
	})
}
