package app

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"GoNavi-Wails/internal/ai"
	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/logger"
	redisbackend "GoNavi-Wails/internal/redis"
	"GoNavi-Wails/internal/sqlaudit"

	goredis "github.com/redis/go-redis/v9"
)

func (a *App) executeRedisCommandFromMCP(ctx context.Context, config connection.ConnectionConfig, dbName, command string) (result connection.QueryResult) {
	if err := ctx.Err(); err != nil {
		return connection.QueryResult{Message: err.Error()}
	}
	args := parseRedisCommand(command)
	if len(args) == 0 {
		return connection.QueryResult{Message: a.appText("redis.backend.error.command_required", nil)}
	}
	if dbName = strings.TrimSpace(dbName); dbName != "" {
		index, err := strconv.Atoi(dbName)
		if err != nil || index < 0 {
			return connection.QueryResult{Message: a.appText("redis.backend.error.select_db_index_invalid", map[string]any{"value": dbName})}
		}
		if (strings.EqualFold(config.Topology, "cluster") || len(config.Hosts) > 1) && index >= 16 {
			return connection.QueryResult{Message: a.appText("redis.backend.error.select_db_index_out_of_range", map[string]any{"min": 0, "max": 15})}
		}
		config.RedisDB, config.Database = index, dbName
	}
	result.QueryID = requestTraceIDFromContext(ctx)
	if result.QueryID == "" {
		result.QueryID = generateQueryID()
	}
	started := time.Now()
	defer func() {
		a.recordSQLAuditQuery(sqlAuditQueryInput{
			Config: config, Database: strconv.Itoa(config.RedisDB), DBType: "redis",
			QueryID: result.QueryID, SQL: command, Source: "mcp", Duration: time.Since(started),
			StatementCount: 1, Result: result, MCPContext: sqlaudit.MCPContextFrom(ctx),
		})
	}()
	// An isolated client keeps dbName and connection-local commands from changing
	// the desktop client's selected database or another MCP request's session.
	client, err := a.openRedisClientIsolatedWithContext(ctx, config)
	if err != nil {
		result.Message = err.Error()
		return result
	}
	redisbackend.BindMetadataContext(client, ctx)
	closeClient := closeConnectionHealthResource(ctx, func() error {
		if err := client.Close(); err != nil {
			logger.Error(err, "关闭 MCP Redis 客户端失败")
			return err
		}
		return nil
	})
	defer redisbackend.ClearMetadataContext(client)
	defer closeClient()
	if err := ctx.Err(); err != nil {
		result.Message = err.Error()
		return result
	}
	value, err := client.ExecuteCommand(args)
	if err != nil && !errors.Is(err, goredis.Nil) {
		result.Message = err.Error()
		result.FailedIndex = 1
		result.OutcomeUnknown = redisCommandOperation(args) != ai.SQLOpQuery && db.IsAmbiguousWriteResponse(err)
		return result
	}
	result.Success = true
	result.ExecutedCount = 1
	result.Data = []connection.ResultSetData{redisCommandResultSet(value)}
	return result
}

func redisCommandResultSet(value any) connection.ResultSetData {
	values, ok := value.([]any)
	if !ok {
		values = []any{value}
	}
	rows := make([]map[string]any, 0, len(values))
	for _, value := range values {
		rows = append(rows, map[string]any{"value": value})
	}
	// The MCP result normalizer applies the row limit and reports truncation.
	return connection.ResultSetData{StatementIndex: 1, Columns: []string{"value"}, Rows: rows}
}
