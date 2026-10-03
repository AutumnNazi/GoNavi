package app

import (
	"context"
	"errors"
	"sync"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	redisbackend "GoNavi-Wails/internal/redis"
)

// metadataSession 仅持有一个 MCP 元数据请求的资源。
// Close 只会在执行请求的协程、元数据方法返回后调用，避免与运行中的查询并发关闭驱动。
type metadataSession struct {
	app         *App
	ctx         context.Context
	synchronous bool

	closeOnce sync.Once
	mu        sync.Mutex
	closed    bool
	databases []db.Database
	redis     []redisbackend.RedisClient
}

type metadataRedisOpenResult struct {
	client redisbackend.RedisClient
	err    error
}

func newMetadataSession(owner *App, ctx context.Context) *metadataSession {
	return newMetadataSessionWithMode(owner, ctx, false)
}

func newMetadataSessionWithMode(owner *App, ctx context.Context, synchronous bool) *metadataSession {
	if owner == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	sessionApp := NewAppWithSecretStore(owner.secretStore)
	sessionApp.ctx = owner.ctx
	sessionApp.webRuntime = owner.webRuntime
	sessionApp.headlessRuntime = owner.headlessRuntime
	sessionApp.startedAt = owner.startedAt
	sessionApp.configDir = owner.configDir
	owner.i18nMu.RLock()
	sessionApp.localizer = owner.localizer
	owner.i18nMu.RUnlock()

	session := &metadataSession{app: sessionApp, ctx: ctx, synchronous: synchronous}
	sessionApp.metadataSession = session
	return session
}

func (s *metadataSession) bindDatabase(database db.Database) {
	if s == nil || database == nil {
		return
	}
	db.BindMetadataContext(database, s.ctx)
	s.mu.Lock()
	s.databases = append(s.databases, database)
	s.mu.Unlock()
}

func (s *metadataSession) bindRedisClient(client redisbackend.RedisClient) bool {
	if s == nil || client == nil {
		return false
	}
	redisbackend.BindMetadataContext(client, s.ctx)
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		redisbackend.ClearMetadataContext(client)
		return false
	}
	s.redis = append(s.redis, client)
	s.mu.Unlock()
	return true
}

func (s *metadataSession) openRedisClient(config connection.ConnectionConfig) (redisbackend.RedisClient, error) {
	if s == nil || s.app == nil {
		return nil, context.Canceled
	}
	if err := s.ctx.Err(); err != nil {
		return nil, err
	}
	if s.synchronous {
		client, err := s.app.openRedisClientIsolated(config)
		if err != nil {
			return nil, err
		}
		if err := s.ctx.Err(); err != nil {
			_ = client.Close()
			return nil, err
		}
		if !s.bindRedisClient(client) {
			_ = client.Close()
			return nil, context.Canceled
		}
		return client, nil
	}
	resultCh := make(chan metadataRedisOpenResult, 1)
	go func() {
		client, err := s.app.openRedisClientIsolated(config)
		if err == nil && client != nil && !s.bindRedisClient(client) {
			_ = client.Close()
			if ctxErr := s.ctx.Err(); ctxErr != nil {
				err = ctxErr
			} else {
				err = context.Canceled
			}
			client = nil
		}
		resultCh <- metadataRedisOpenResult{client: client, err: err}
	}()

	var result metadataRedisOpenResult
	select {
	case <-s.ctx.Done():
		return nil, s.ctx.Err()
	case result = <-resultCh:
	}
	if result.err != nil {
		return nil, result.err
	}
	if err := s.ctx.Err(); err != nil {
		return nil, err
	}
	return result.client, nil
}

func (s *metadataSession) Close() {
	if s == nil || s.app == nil {
		return
	}
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closed = true
		databases := append([]db.Database(nil), s.databases...)
		clients := append([]redisbackend.RedisClient(nil), s.redis...)
		s.databases = nil
		s.redis = nil
		s.mu.Unlock()

		for _, database := range databases {
			db.ClearMetadataContext(database)
		}
		for _, client := range clients {
			redisbackend.ClearMetadataContext(client)
		}
		s.app.beginDatabaseShutdown()
		s.app.closeCachedDatabasesForShutdown()
		for _, client := range clients {
			if client != nil {
				_ = client.Close()
			}
		}
	})
}

func (a *App) runMetadataWithContext(ctx context.Context, operation func(*App) connection.QueryResult) connection.QueryResult {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}

	session := newMetadataSession(a, ctx)
	if session == nil {
		return connection.QueryResult{Success: false, Message: "元数据会话不可用"}
	}

	resultCh := make(chan connection.QueryResult, 1)
	go func() {
		result := operation(session.app)
		session.Close()
		resultCh <- result
	}()

	select {
	case result := <-resultCh:
		if err := ctx.Err(); err != nil {
			return connection.QueryResult{Success: false, Message: err.Error()}
		}
		return result
	case <-ctx.Done():
		// 不在此处关闭：Database 未承诺 Close 可与 Query 并发执行。
		// Query 会收到 ctx，工作协程只在查询返回后关闭资源。
		return connection.QueryResult{Success: false, Message: ctx.Err().Error()}
	}
}

// runWebMetadataWithContext is deliberately synchronous. Context-aware
// drivers observe cancellation through their bound metadata context; legacy
// Connect/query calls finish in this goroutine before the HTTP handler returns.
func (a *App) runWebMetadataWithContext(ctx context.Context, operation func(*App) connection.QueryResult) connection.QueryResult {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	session := newMetadataSessionWithMode(a, ctx, true)
	if session == nil {
		return connection.QueryResult{Success: false, Message: "元数据会话不可用"}
	}
	defer session.Close()
	result := operation(session.app)
	if err := ctx.Err(); err != nil && result.Success {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	return result
}

// errMetadataSessionUnavailable 表示元数据会话无法建立（owner 为空）。
var errMetadataSessionUnavailable = errors.New("metadata session is unavailable")

// withWebMetadataSession 让一次操作内的多个元数据 RPC 复用同一个会话。
//
// 每个 runWebMetadataWithContext 都会新建一个连接缓存为空的会话，并在返回时
// 关闭其中所有连接。逐表调用因此退化成「N 张表 = N 次完整建连」，在 SSH 转发
// 下单次建连约 3.4 秒，几十张表的映射校验就会长时间停在预检阶段。
//
// 连接仍绑定本次 ctx，取消与超时语义不变；operation 返回后所有连接统一关闭。
//
// synchronous 必须为 false：取 true 时会话内的连接走
// getDatabaseSynchronouslyWithContext，而它同步等待 Connect，不响应 ctx。
// 驱动在 SSH 转发下卡住时，调用方的超时形同虚设 —— 预检会一直转圈到用户
// 强杀进程。异步版本在 ctx 超时后即返回，让上层的超时真正生效。
func (a *App) withWebMetadataSession(ctx context.Context, operation func(session *App) error) error {
	session := newMetadataSessionWithMode(a, ctx, false)
	if session == nil {
		return errMetadataSessionUnavailable
	}
	defer session.Close()
	return operation(session.app)
}

func (a *App) DBGetDatabasesContext(ctx context.Context, config connection.ConnectionConfig) connection.QueryResult {
	return a.runMetadataWithContext(ctx, func(session *App) connection.QueryResult { return session.DBGetDatabases(config) })
}

func (a *App) DBGetTablesContext(ctx context.Context, config connection.ConnectionConfig, dbName string) connection.QueryResult {
	return a.runMetadataWithContext(ctx, func(session *App) connection.QueryResult { return session.DBGetTables(config, dbName) })
}

func (a *App) DBGetViewsContext(ctx context.Context, config connection.ConnectionConfig, dbName string) connection.QueryResult {
	return a.runMetadataWithContext(ctx, func(session *App) connection.QueryResult { return session.DBGetViews(config, dbName) })
}

func (a *App) DBGetObjectsContext(ctx context.Context, config connection.ConnectionConfig, dbName string) connection.QueryResult {
	return a.runMetadataWithContext(ctx, func(session *App) connection.QueryResult { return session.DBGetObjects(config, dbName) })
}

func (a *App) DBGetAllColumnsContext(ctx context.Context, config connection.ConnectionConfig, dbName string) connection.QueryResult {
	return a.runMetadataWithContext(ctx, func(session *App) connection.QueryResult { return session.DBGetAllColumns(config, dbName) })
}

func (a *App) DBGetColumnsContext(ctx context.Context, config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return a.runMetadataWithContext(ctx, func(session *App) connection.QueryResult { return session.DBGetColumns(config, dbName, tableName) })
}

func (a *App) DBGetIndexesContext(ctx context.Context, config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return a.runMetadataWithContext(ctx, func(session *App) connection.QueryResult { return session.DBGetIndexes(config, dbName, tableName) })
}

func (a *App) DBGetForeignKeysContext(ctx context.Context, config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return a.runMetadataWithContext(ctx, func(session *App) connection.QueryResult { return session.DBGetForeignKeys(config, dbName, tableName) })
}

func (a *App) DBGetTriggersContext(ctx context.Context, config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return a.runMetadataWithContext(ctx, func(session *App) connection.QueryResult { return session.DBGetTriggers(config, dbName, tableName) })
}

func (a *App) DBShowCreateTableContext(ctx context.Context, config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return a.runMetadataWithContext(ctx, func(session *App) connection.QueryResult { return session.DBShowCreateTable(config, dbName, tableName) })
}

// bindMetadataDatabase 把数据库实例挂到当前元数据会话上，
// 供 getDatabase 家族在取回实例后登记元数据请求上下文。
func (a *App) bindMetadataDatabase(instance db.Database) {
	if a == nil || a.metadataSession == nil || instance == nil {
		return
	}
	a.metadataSession.bindDatabase(instance)
}
