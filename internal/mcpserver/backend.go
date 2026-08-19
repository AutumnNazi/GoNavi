package mcpserver

import (
	"context"
	"fmt"
	"strings"

	"GoNavi-Wails/internal/ai"
	aiservice "GoNavi-Wails/internal/ai/service"
	appcore "GoNavi-Wails/internal/app"
	"GoNavi-Wails/internal/appdata"
	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/requesttrace"
)

// Backend 抽象 GoNavi 后端能力，便于复用真实 App 和单元测试替身。
type Backend interface {
	Close(context.Context) error
	GetSavedConnections() ([]connection.SavedConnectionView, error)
	GetEditableSavedConnection(id string) (connection.SavedConnectionView, error)
	DBGetDatabases(config connection.ConnectionConfig) connection.QueryResult
	DBGetTables(config connection.ConnectionConfig, dbName string) connection.QueryResult
	DBGetViews(config connection.ConnectionConfig, dbName string) connection.QueryResult
	DBGetObjects(config connection.ConnectionConfig, dbName string) connection.QueryResult
	DBGetAllColumns(config connection.ConnectionConfig, dbName string) connection.QueryResult
	DBGetColumns(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult
	DBGetIndexes(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult
	DBGetForeignKeys(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult
	DBGetTriggers(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult
	DBShowCreateTable(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult
	ExecuteSQLFromMCP(context.Context, connection.ConnectionConfig, string, string) connection.QueryResult
	InspectSQL(dbType string, sql string) appcore.SQLInspection
	GetSQLSafetyLevel() ai.SQLPermissionLevel
	AuthorizeSQLConnection(config connection.ConnectionConfig, sql string) error
}

// executionAuthorizingBackend is intentionally optional for non-App backend
// implementations. Production AppBackend uses it to close the gap between the
// service's presentation-time policy check and database dispatch.
type executionAuthorizingBackend interface {
	ExecuteAuthorizedSQLFromMCP(context.Context, string, connection.ConnectionConfig, string, string, bool) connection.QueryResult
}

// AppBackend 基于现有 internal/app.App 暴露 MCP 所需数据库能力。
type AppBackend struct {
	app              *appcore.App
	mcpQueryExecutor *appcore.MCPQueryExecutor
}

func NewAppBackend(ctx context.Context) (*AppBackend, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	a, err := appcore.NewHeadlessApp(ctx, "")
	if err != nil {
		return nil, err
	}
	return &AppBackend{app: a, mcpQueryExecutor: appcore.NewMCPQueryExecutor(a)}, nil
}

func (b *AppBackend) Close(ctx context.Context) error {
	if b == nil || b.app == nil {
		return nil
	}
	b.app.Shutdown()
	return nil
}

func (b *AppBackend) RequestTraceStore() *requesttrace.Store {
	if b == nil || b.app == nil {
		return nil
	}
	return appcore.RequestTraceStoreForEntryPoint(b.app)
}

func (b *AppBackend) GetSavedConnections() ([]connection.SavedConnectionView, error) {
	return b.app.GetSavedConnections()
}

func (b *AppBackend) GetEditableSavedConnection(id string) (connection.SavedConnectionView, error) {
	return b.app.GetEditableSavedConnection(id)
}

func (b *AppBackend) DBGetDatabases(config connection.ConnectionConfig) connection.QueryResult {
	return b.app.DBGetDatabases(config)
}

func (b *AppBackend) DBGetTables(config connection.ConnectionConfig, dbName string) connection.QueryResult {
	return b.app.DBGetTables(config, dbName)
}

func (b *AppBackend) DBGetViews(config connection.ConnectionConfig, dbName string) connection.QueryResult {
	return b.app.DBGetViews(config, dbName)
}

func (b *AppBackend) DBGetObjects(config connection.ConnectionConfig, dbName string) connection.QueryResult {
	return b.app.DBGetObjects(config, dbName)
}

func (b *AppBackend) DBGetAllColumns(config connection.ConnectionConfig, dbName string) connection.QueryResult {
	return b.app.DBGetAllColumns(config, dbName)
}

func (b *AppBackend) DBGetColumns(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return b.app.DBGetColumns(config, dbName, tableName)
}

func (b *AppBackend) DBGetIndexes(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return b.app.DBGetIndexes(config, dbName, tableName)
}

func (b *AppBackend) DBGetForeignKeys(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return b.app.DBGetForeignKeys(config, dbName, tableName)
}

func (b *AppBackend) DBGetTriggers(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return b.app.DBGetTriggers(config, dbName, tableName)
}

func (b *AppBackend) DBShowCreateTable(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return b.app.DBShowCreateTable(config, dbName, tableName)
}

// ExecuteAuthorizedSQLFromMCP resolves the saved connection and checks its
// current protections immediately before dispatching SQL. The service's
// earlier display snapshot is not trusted for this authorization boundary.
func (b *AppBackend) ExecuteSQLFromMCP(ctx context.Context, config connection.ConnectionConfig, dbName string, query string) connection.QueryResult {
	return b.executeAuthorizedSQLFromMCP(ctx, strings.TrimSpace(config.ID), config, dbName, query, true)
}

// ExecuteAuthorizedSQLFromMCP is the explicit authorization-bound entry point
// used by Service. It re-reads the saved connection immediately before SQL is
// dispatched, closing the stale-view TOCTOU window.
func (b *AppBackend) ExecuteAuthorizedSQLFromMCP(ctx context.Context, connectionID string, config connection.ConnectionConfig, dbName string, query string, allowMutating bool) connection.QueryResult {
	return b.executeAuthorizedSQLFromMCP(ctx, strings.TrimSpace(connectionID), config, dbName, query, allowMutating)
}

func (b *AppBackend) executeAuthorizedSQLFromMCP(ctx context.Context, connectionID string, config connection.ConnectionConfig, dbName string, query string, allowMutating bool) connection.QueryResult {
	if b == nil || b.mcpQueryExecutor == nil {
		return connection.QueryResult{Success: false, Message: "MCP backend is unavailable"}
	}
	connectionID = strings.TrimSpace(connectionID)
	if connectionID == "" {
		return connection.QueryResult{Success: false, Message: "MCP saved connection ID is required"}
	}
	config.ID = connectionID
	return b.mcpQueryExecutor.DBQueryMultiAuthorizedContext(ctx, config, dbName, query, allowMutating)
}

func (b *AppBackend) InspectSQL(dbType string, sql string) appcore.SQLInspection {
	return appcore.InspectSQL(dbType, sql)
}

func (b *AppBackend) GetSQLSafetyLevel() ai.SQLPermissionLevel {
	inspection, err := aiservice.NewProviderConfigStore(appdata.MustResolveActiveRoot(), nil).Inspect()
	if err != nil {
		logger.Error(err, "加载 MCP SQL 安全控制失败，按只读模式回退")
		return ai.PermissionReadOnly
	}

	switch inspection.Snapshot.SafetyLevel {
	case ai.PermissionReadOnly, ai.PermissionReadWrite, ai.PermissionFull:
		return inspection.Snapshot.SafetyLevel
	default:
		return ai.PermissionReadOnly
	}
}

func (b *AppBackend) AuthorizeSQLConnection(config connection.ConnectionConfig, sql string) error {
	if b == nil || b.app == nil {
		return fmt.Errorf("MCP backend is unavailable")
	}
	return b.app.AuthorizeMCPConnectionSQL(config, sql)
}
