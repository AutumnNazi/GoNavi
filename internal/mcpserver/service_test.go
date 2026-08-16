package mcpserver

import (
	"context"
	"errors"
	"strings"
	"testing"

	"GoNavi-Wails/internal/ai"
	appcore "GoNavi-Wails/internal/app"
	"GoNavi-Wails/internal/connection"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type fakeBackend struct {
	savedConnections    []connection.SavedConnectionView
	savedConnectionsErr error
	editableConnection  connection.SavedConnectionView
	editableErr         error
	databasesResult     connection.QueryResult
	tablesResult        connection.QueryResult
	viewsResult         connection.QueryResult
	objectsResult       connection.QueryResult
	allColumnsResult    connection.QueryResult
	columnsResult       connection.QueryResult
	indexesResult       connection.QueryResult
	foreignKeysResult   connection.QueryResult
	triggersResult      connection.QueryResult
	ddlResult           connection.QueryResult
	queryResult         connection.QueryResult
	inspection          appcore.SQLInspection
	safetyLevel         ai.SQLPermissionLevel
	queryCalled         bool
	queryContext        context.Context
	authorizeErr        error
	authorizeCalls      int
	authorizedConfig    connection.ConnectionConfig
	authorizedSQL       string
	events              []string
}

func (f *fakeBackend) Close(context.Context) error {
	return nil
}

func (f *fakeBackend) GetSavedConnections() ([]connection.SavedConnectionView, error) {
	return f.savedConnections, f.savedConnectionsErr
}

func (f *fakeBackend) GetEditableSavedConnection(id string) (connection.SavedConnectionView, error) {
	return f.editableConnection, f.editableErr
}

func (f *fakeBackend) DBGetDatabases(config connection.ConnectionConfig) connection.QueryResult {
	return f.databasesResult
}

func (f *fakeBackend) DBGetTables(config connection.ConnectionConfig, dbName string) connection.QueryResult {
	return f.tablesResult
}

func (f *fakeBackend) DBGetViews(config connection.ConnectionConfig, dbName string) connection.QueryResult {
	return f.viewsResult
}

func (f *fakeBackend) DBGetObjects(config connection.ConnectionConfig, dbName string) connection.QueryResult {
	return f.objectsResult
}

func (f *fakeBackend) DBGetAllColumns(config connection.ConnectionConfig, dbName string) connection.QueryResult {
	return f.allColumnsResult
}

func (f *fakeBackend) DBGetColumns(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return f.columnsResult
}

func (f *fakeBackend) DBGetIndexes(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return f.indexesResult
}

func (f *fakeBackend) DBGetForeignKeys(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return f.foreignKeysResult
}

func (f *fakeBackend) DBGetTriggers(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return f.triggersResult
}

func (f *fakeBackend) DBShowCreateTable(config connection.ConnectionConfig, dbName string, tableName string) connection.QueryResult {
	return f.ddlResult
}

func (f *fakeBackend) ExecuteSQLFromMCP(ctx context.Context, config connection.ConnectionConfig, dbName string, query string) connection.QueryResult {
	f.queryCalled = true
	f.queryContext = ctx
	f.events = append(f.events, "query")
	return f.queryResult
}

func (f *fakeBackend) InspectSQL(dbType string, sql string) appcore.SQLInspection {
	return f.inspection
}

func (f *fakeBackend) GetSQLSafetyLevel() ai.SQLPermissionLevel {
	if f.safetyLevel == "" {
		return ai.PermissionReadOnly
	}
	return f.safetyLevel
}

func (f *fakeBackend) AuthorizeSQLConnection(config connection.ConnectionConfig, sql string) error {
	f.authorizeCalls++
	f.authorizedConfig = config
	f.authorizedSQL = sql
	f.events = append(f.events, "authorize")
	return f.authorizeErr
}

func TestGetConnectionsReturnsSavedConnectionSummaries(t *testing.T) {
	backend := &fakeBackend{
		savedConnections: []connection.SavedConnectionView{
			{
				ID:   "mysql-main",
				Name: "MySQL Main",
				Config: connection.ConnectionConfig{
					Type:     "mysql",
					Host:     "10.0.0.8",
					Port:     3306,
					Database: "app",
					UseSSH:   true,
				},
			},
			{
				ID:   "duckdb-local",
				Name: "DuckDB Local",
				Config: connection.ConnectionConfig{
					Type:     "duckdb",
					Database: `C:\data\example.duckdb`,
				},
			},
		},
	}

	service := NewService(backend)
	result, out, err := service.GetConnections(context.Background(), nil, emptyArgs{})
	if err != nil {
		t.Fatalf("GetConnections returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected success result, got %#v", result)
	}
	if len(out.Connections) != 2 {
		t.Fatalf("expected 2 connections, got %d", len(out.Connections))
	}
	if out.Connections[0].Target != "10.0.0.8:3306" {
		t.Fatalf("unexpected mysql target: %q", out.Connections[0].Target)
	}
	if out.Connections[1].Target != `C:\data\example.duckdb` {
		t.Fatalf("unexpected duckdb target: %q", out.Connections[1].Target)
	}
}

func TestGetConnectionsRedactsOpaqueURIAndDSNTargets(t *testing.T) {
	backend := &fakeBackend{
		savedConnections: []connection.SavedConnectionView{
			{
				ID:   "pg-uri",
				Name: "Postgres URI",
				Config: connection.ConnectionConfig{
					Type: "postgres",
					URI:  "postgres://postgres:secret@db.local:5432/app?sslmode=disable",
				},
			},
			{
				ID:   "mysql-dsn",
				Name: "MySQL DSN",
				Config: connection.ConnectionConfig{
					Type: "mysql",
					DSN:  "root:secret@tcp(db.local:3306)/app?charset=utf8mb4",
				},
			},
		},
	}

	service := NewService(backend)
	result, out, err := service.GetConnections(context.Background(), nil, emptyArgs{})
	if err != nil {
		t.Fatalf("GetConnections returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected success result, got %#v", result)
	}
	if len(out.Connections) != 2 {
		t.Fatalf("expected 2 connections, got %d", len(out.Connections))
	}
	if out.Connections[0].Target != "postgres://db.local:5432/app" {
		t.Fatalf("expected URI target to remove credentials and query, got %q", out.Connections[0].Target)
	}
	if strings.Contains(out.Connections[0].Target, "secret") || strings.Contains(out.Connections[0].Target, "postgres@") {
		t.Fatalf("URI target leaked credentials: %q", out.Connections[0].Target)
	}
	if out.Connections[1].Target != redactedOpaqueTarget {
		t.Fatalf("expected opaque DSN target to be redacted, got %q", out.Connections[1].Target)
	}
}

func TestGetAllColumnsReturnsCrossTableColumnSummaries(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		allColumnsResult: connection.QueryResult{
			Success: true,
			Data: []connection.ColumnDefinitionWithTable{
				{TableName: "users", Name: "email", Type: "varchar(255)", Comment: "用户邮箱"},
				{TableName: "orders", Name: "user_id", Type: "bigint", Comment: "关联用户"},
			},
		},
	}

	service := NewService(backend)
	result, out, err := service.GetAllColumns(context.Background(), nil, databaseArgs{
		ConnectionID: "mysql-main",
		DBName:       "app",
	})
	if err != nil {
		t.Fatalf("GetAllColumns returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected success result, got %#v", result)
	}
	if len(out.Columns) != 2 || out.Columns[0].TableName != "users" || out.Columns[1].Name != "user_id" {
		t.Fatalf("unexpected all columns output: %#v", out)
	}
}

func TestGetViewsReturnsViewNames(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		viewsResult: connection.QueryResult{
			Success: true,
			Data: []map[string]string{
				{"View": "active_users"},
				{"View": "reporting.monthly_orders"},
			},
		},
	}

	service := NewService(backend)
	result, out, err := service.GetViews(context.Background(), nil, databaseArgs{
		ConnectionID: "mysql-main",
		DBName:       "app",
	})
	if err != nil {
		t.Fatalf("GetViews returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected success result, got %#v", result)
	}
	if len(out.Views) != 2 || out.Views[0] != "active_users" || out.Views[1] != "reporting.monthly_orders" {
		t.Fatalf("unexpected views output: %#v", out)
	}
}

func TestGetTablesIncludesViewsInDedicatedField(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		tablesResult: connection.QueryResult{
			Success: true,
			Data: []map[string]string{
				{"Table": "users"},
			},
		},
		viewsResult: connection.QueryResult{
			Success: true,
			Data: []map[string]string{
				{"View": "active_users"},
			},
		},
	}

	service := NewService(backend)
	result, out, err := service.GetTables(context.Background(), nil, databaseArgs{
		ConnectionID: "mysql-main",
		DBName:       "app",
	})
	if err != nil {
		t.Fatalf("GetTables returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected success result, got %#v", result)
	}
	if len(out.Tables) != 1 || out.Tables[0] != "users" {
		t.Fatalf("unexpected tables output: %#v", out)
	}
	if len(out.Views) != 1 || out.Views[0] != "active_users" {
		t.Fatalf("expected GetTables to expose views separately, got %#v", out)
	}
}

func TestGetObjectsReturnsDatabaseObjectsAndFiltersByType(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		objectsResult: connection.QueryResult{
			Success: true,
			Data: []connection.DatabaseObject{
				{Database: "app", Name: "users", Type: "table"},
				{Database: "app", Name: "active_users", Type: "view"},
				{Database: "app", Schema: "public", Name: "refresh_cache", Type: "function"},
				{Database: "app", Name: "orders.events", Type: "queue"},
			},
		},
	}

	service := NewService(backend)
	result, out, err := service.GetObjects(context.Background(), nil, objectsArgs{
		ConnectionID: "mysql-main",
		DBName:       "app",
		ObjectTypes:  []string{"function", "queues"},
	})
	if err != nil {
		t.Fatalf("GetObjects returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected success result, got %#v", result)
	}
	if len(out.Objects) != 2 {
		t.Fatalf("expected 2 filtered objects, got %#v", out.Objects)
	}
	if out.Objects[0].Type != "function" || out.Objects[1].Type != "queue" {
		t.Fatalf("unexpected filtered objects: %#v", out.Objects)
	}
	if out.Objects[1].Name != "orders.events" {
		t.Fatalf("queue names must preserve dots, got %#v", out.Objects[1])
	}
}

func TestGetObjectsPreservesPartialMetadataWarnings(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID:     "mysql-main",
			Config: connection.ConnectionConfig{Type: "mysql", Database: "app"},
		},
		objectsResult: connection.QueryResult{
			Success:           true,
			Partial:           true,
			Retryable:         true,
			Warnings:          []string{"读取 view 对象元数据失败: permission denied"},
			FailedObjectTypes: []string{"view"},
			Data:              []connection.DatabaseObject{{Database: "app", Name: "users", Type: "table"}},
		},
	}

	result, out, err := NewService(backend).GetObjects(context.Background(), nil, objectsArgs{ConnectionID: "mysql-main", DBName: "app"})
	if err != nil || result == nil || result.IsError {
		t.Fatalf("expected partial metadata success, result=%#v err=%v", result, err)
	}
	if !out.Partial || !out.Retryable || len(out.Warnings) != 1 || len(out.FailedObjectTypes) != 1 || out.FailedObjectTypes[0] != "view" {
		t.Fatalf("partial metadata details were lost: %#v", out)
	}
}

func TestGetObjectsMarksBaseMetadataFailureRetryable(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{ID: "mysql-main", Config: connection.ConnectionConfig{Type: "mysql", Database: "app"}},
		objectsResult: connection.QueryResult{
			Success:           false,
			Partial:           true,
			Retryable:         true,
			Message:           "读取 table 对象元数据失败: permission denied",
			FailedObjectTypes: []string{"table"},
		},
	}

	result, out, err := NewService(backend).GetObjects(context.Background(), nil, objectsArgs{ConnectionID: "mysql-main", DBName: "app"})
	if err != nil || result == nil || !result.IsError {
		t.Fatalf("expected retryable tool error, result=%#v err=%v", result, err)
	}
	text := firstTextContent(result)
	if !strings.Contains(text, "table") || !strings.Contains(text, "可重试") {
		t.Fatalf("expected failure category and retry guidance, got %q", text)
	}
	if !out.Partial || !out.Retryable || len(out.Warnings) != 1 || len(out.FailedObjectTypes) != 1 || out.FailedObjectTypes[0] != "table" {
		t.Fatalf("expected structured retry metadata, got %#v", out)
	}
}

func TestGetIndexesReturnsIndexDefinitions(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		indexesResult: connection.QueryResult{
			Success: true,
			Data: []connection.IndexDefinition{
				{Name: "idx_users_email", ColumnName: "email", NonUnique: 0, SeqInIndex: 1, IndexType: "BTREE"},
			},
		},
	}

	service := NewService(backend)
	result, out, err := service.GetIndexes(context.Background(), nil, tableArgs{
		ConnectionID: "mysql-main",
		DBName:       "app",
		TableName:    "users",
	})
	if err != nil {
		t.Fatalf("GetIndexes returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected success result, got %#v", result)
	}
	if len(out.Indexes) != 1 || out.Indexes[0].Name != "idx_users_email" {
		t.Fatalf("unexpected indexes output: %#v", out)
	}
}

func TestGetForeignKeysReturnsForeignKeyDefinitions(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		foreignKeysResult: connection.QueryResult{
			Success: true,
			Data: []connection.ForeignKeyDefinition{
				{Name: "fk_orders_user_id", ColumnName: "user_id", RefTableName: "users", RefColumnName: "id", ConstraintName: "fk_orders_user_id"},
			},
		},
	}

	service := NewService(backend)
	result, out, err := service.GetForeignKeys(context.Background(), nil, tableArgs{
		ConnectionID: "mysql-main",
		DBName:       "app",
		TableName:    "orders",
	})
	if err != nil {
		t.Fatalf("GetForeignKeys returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected success result, got %#v", result)
	}
	if len(out.ForeignKeys) != 1 || out.ForeignKeys[0].RefTableName != "users" {
		t.Fatalf("unexpected foreign keys output: %#v", out)
	}
}

func TestGetTriggersReturnsTriggerDefinitions(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		triggersResult: connection.QueryResult{
			Success: true,
			Data: []connection.TriggerDefinition{
				{Name: "trg_orders_audit", Timing: "AFTER", Event: "INSERT", Statement: "INSERT INTO audit_log ..."},
			},
		},
	}

	service := NewService(backend)
	result, out, err := service.GetTriggers(context.Background(), nil, tableArgs{
		ConnectionID: "mysql-main",
		DBName:       "app",
		TableName:    "orders",
	})
	if err != nil {
		t.Fatalf("GetTriggers returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected success result, got %#v", result)
	}
	if len(out.Triggers) != 1 || out.Triggers[0].Name != "trg_orders_audit" {
		t.Fatalf("unexpected triggers output: %#v", out)
	}
}

func TestExecuteSQLRejectsMutatingStatementsWithoutAllowMutating(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		inspection: appcore.SQLInspection{
			StatementCount: 1,
			ReadOnly:       false,
			Statements: []appcore.SQLStatementInspection{
				{Index: 1, Keyword: "delete", ReadOnly: false},
			},
		},
		safetyLevel: ai.PermissionReadWrite,
	}

	service := NewService(backend)
	result, _, err := service.ExecuteSQL(context.Background(), nil, executeSQLArgs{
		ConnectionID: "mysql-main",
		SQL:          "delete from users where id = 1",
	})
	if err != nil {
		t.Fatalf("ExecuteSQL returned error: %v", err)
	}
	if result == nil || !result.IsError {
		t.Fatalf("expected tool error, got %#v", result)
	}
	if !strings.Contains(firstTextContent(result), "allowMutating=true") {
		t.Fatalf("unexpected error text: %q", firstTextContent(result))
	}
	if backend.queryCalled {
		t.Fatalf("expected SQL not to execute when allowMutating is false")
	}
}

func TestExecuteSQLRejectsMutatingStatementsWhenAISafetyIsReadOnly(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		inspection: appcore.SQLInspection{
			StatementCount: 1,
			ReadOnly:       false,
			Statements: []appcore.SQLStatementInspection{
				{Index: 1, Keyword: "delete", ReadOnly: false},
			},
		},
		safetyLevel: ai.PermissionReadOnly,
	}

	service := NewService(backend)
	result, _, err := service.ExecuteSQL(context.Background(), nil, executeSQLArgs{
		ConnectionID:  "mysql-main",
		SQL:           "delete from users where id = 1",
		AllowMutating: true,
	})
	if err != nil {
		t.Fatalf("ExecuteSQL returned error: %v", err)
	}
	if result == nil || !result.IsError {
		t.Fatalf("expected tool error, got %#v", result)
	}
	if !strings.Contains(firstTextContent(result), "只读模式") {
		t.Fatalf("unexpected error text: %q", firstTextContent(result))
	}
	if backend.queryCalled {
		t.Fatalf("expected SQL not to execute when AI safety is readonly")
	}
}

func TestExecuteSQLRejectsDDLWhenAISafetyIsReadWrite(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		inspection: appcore.SQLInspection{
			StatementCount: 1,
			ReadOnly:       false,
			Statements: []appcore.SQLStatementInspection{
				{Index: 1, Keyword: "drop", ReadOnly: false},
			},
		},
		safetyLevel: ai.PermissionReadWrite,
	}

	service := NewService(backend)
	result, _, err := service.ExecuteSQL(context.Background(), nil, executeSQLArgs{
		ConnectionID:  "mysql-main",
		SQL:           "drop table users",
		AllowMutating: true,
	})
	if err != nil {
		t.Fatalf("ExecuteSQL returned error: %v", err)
	}
	if result == nil || !result.IsError {
		t.Fatalf("expected tool error, got %#v", result)
	}
	text := firstTextContent(result)
	if !strings.Contains(text, "读写模式") || !strings.Contains(text, "DDL") {
		t.Fatalf("unexpected error text: %q", text)
	}
	if backend.queryCalled {
		t.Fatalf("expected SQL not to execute when AI safety blocks DDL")
	}
}

func TestExecuteSQLRejectsMixedStatementsWhenAISafetyBlocksLaterStatement(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		inspection: appcore.SQLInspection{
			StatementCount: 2,
			ReadOnly:       false,
			Statements: []appcore.SQLStatementInspection{
				{Index: 1, Keyword: "select", ReadOnly: true},
				{Index: 2, Keyword: "delete", ReadOnly: false},
			},
		},
		safetyLevel: ai.PermissionReadOnly,
	}

	service := NewService(backend)
	result, _, err := service.ExecuteSQL(context.Background(), nil, executeSQLArgs{
		ConnectionID:  "mysql-main",
		SQL:           "select * from users; delete from users where id = 1",
		AllowMutating: true,
	})
	if err != nil {
		t.Fatalf("ExecuteSQL returned error: %v", err)
	}
	if result == nil || !result.IsError {
		t.Fatalf("expected tool error, got %#v", result)
	}
	if !strings.Contains(firstTextContent(result), "#2 delete") {
		t.Fatalf("unexpected error text: %q", firstTextContent(result))
	}
	if backend.queryCalled {
		t.Fatalf("expected SQL not to execute when a later statement is blocked")
	}
}

func TestExecuteSQLAllowsDMLWhenAISafetyIsReadWriteAndAllowMutating(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		inspection: appcore.SQLInspection{
			StatementCount: 1,
			ReadOnly:       false,
			Statements: []appcore.SQLStatementInspection{
				{Index: 1, Keyword: "insert", ReadOnly: false},
			},
		},
		safetyLevel: ai.PermissionReadWrite,
		queryResult: connection.QueryResult{
			Success: true,
			Data:    []connection.ResultSetData{},
		},
	}

	service := NewService(backend)
	result, out, err := service.ExecuteSQL(context.Background(), nil, executeSQLArgs{
		ConnectionID:  "mysql-main",
		SQL:           "insert into users(id) values (1)",
		AllowMutating: true,
	})
	if err != nil {
		t.Fatalf("ExecuteSQL returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected success result, got %#v", result)
	}
	if !backend.queryCalled {
		t.Fatalf("expected SQL to be executed")
	}
	if out.ReadOnly {
		t.Fatalf("expected mutating SQL result, got %#v", out)
	}
}

func TestExecuteSQLRejectsConnectionWriteProtection(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID:     "mysql-main",
			Config: connection.ConnectionConfig{Type: "mysql", Database: "app"},
		},
		inspection: appcore.SQLInspection{
			StatementCount: 1,
			ReadOnly:       false,
			Statements:     []appcore.SQLStatementInspection{{Index: 1, Keyword: "update", ReadOnly: false}},
		},
		safetyLevel:  ai.PermissionReadWrite,
		authorizeErr: errors.New("data editing is disabled for this connection"),
	}

	result, _, err := NewService(backend).ExecuteSQL(context.Background(), nil, executeSQLArgs{
		ConnectionID:  "mysql-main",
		SQL:           "UPDATE users SET active = 1",
		AllowMutating: true,
	})
	if err != nil {
		t.Fatalf("ExecuteSQL returned error: %v", err)
	}
	if result == nil || !result.IsError || backend.queryCalled {
		t.Fatalf("connection protection should stop execution: result=%#v called=%t", result, backend.queryCalled)
	}
	if !strings.Contains(firstTextContent(result), "data editing is disabled") {
		t.Fatalf("unexpected protection error: %q", firstTextContent(result))
	}
	if backend.authorizeCalls != 1 {
		t.Fatalf("connection authorization calls = %d, want 1", backend.authorizeCalls)
	}
}

func TestExecuteSQLAuthorizesExactlyOnceBeforeExecution(t *testing.T) {
	tests := []struct {
		name          string
		sql           string
		keyword       string
		readOnly      bool
		safetyLevel   ai.SQLPermissionLevel
		allowMutating bool
	}{
		{name: "query", sql: "SELECT 1", keyword: "select", readOnly: true, safetyLevel: ai.PermissionReadOnly},
		{name: "DML", sql: "UPDATE users SET active = 1", keyword: "update", safetyLevel: ai.PermissionReadWrite, allowMutating: true},
		{name: "DDL", sql: "CREATE TABLE audit_probe(id INT)", keyword: "create", safetyLevel: ai.PermissionFull, allowMutating: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			config := connection.ConnectionConfig{ID: "postgres-main", Type: "postgres", Database: "app"}
			backend := &fakeBackend{
				editableConnection: connection.SavedConnectionView{ID: config.ID, Config: config},
				inspection: appcore.SQLInspection{
					StatementCount: 1,
					ReadOnly:       test.readOnly,
					Statements:     []appcore.SQLStatementInspection{{Index: 1, Keyword: test.keyword, ReadOnly: test.readOnly}},
				},
				safetyLevel: test.safetyLevel,
				queryResult: connection.QueryResult{Success: true, Data: []connection.ResultSetData{}},
			}

			result, _, err := NewService(backend).ExecuteSQL(context.Background(), nil, executeSQLArgs{
				ConnectionID:  config.ID,
				SQL:           test.sql,
				AllowMutating: test.allowMutating,
			})
			if err != nil || result == nil || result.IsError {
				t.Fatalf("ExecuteSQL result=%#v err=%v", result, err)
			}
			if backend.authorizeCalls != 1 || backend.authorizedConfig.ID != config.ID || backend.authorizedSQL != test.sql {
				t.Fatalf("authorization calls=%d config=%#v sql=%q", backend.authorizeCalls, backend.authorizedConfig, backend.authorizedSQL)
			}
			if strings.Join(backend.events, ",") != "authorize,query" {
				t.Fatalf("execution order = %v, want authorize before query", backend.events)
			}
		})
	}
}

func TestExecuteSQLRejectsInconsistentSafetyInspection(t *testing.T) {
	tests := []struct {
		name       string
		inspection appcore.SQLInspection
	}{
		{
			name: "statement count mismatch",
			inspection: appcore.SQLInspection{
				StatementCount: 1,
				ReadOnly:       true,
			},
		},
		{
			name: "aggregate read-only mismatch",
			inspection: appcore.SQLInspection{
				StatementCount: 1,
				ReadOnly:       true,
				Statements:     []appcore.SQLStatementInspection{{Index: 1, Keyword: "update", ReadOnly: false}},
			},
		},
		{
			name: "non-sequential statement index",
			inspection: appcore.SQLInspection{
				StatementCount: 1,
				ReadOnly:       false,
				Statements:     []appcore.SQLStatementInspection{{Index: 2, Keyword: "update", ReadOnly: false}},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			backend := &fakeBackend{
				editableConnection: connection.SavedConnectionView{
					ID:     "postgres-main",
					Config: connection.ConnectionConfig{Type: "postgres", Database: "app"},
				},
				inspection:  test.inspection,
				safetyLevel: ai.PermissionFull,
				queryResult: connection.QueryResult{Success: true, Data: []connection.ResultSetData{}},
			}

			result, _, err := NewService(backend).ExecuteSQL(context.Background(), nil, executeSQLArgs{
				ConnectionID:  "postgres-main",
				SQL:           "UPDATE users SET active = 1",
				AllowMutating: true,
			})
			if err != nil {
				t.Fatalf("ExecuteSQL returned error: %v", err)
			}
			if result == nil || !result.IsError || backend.authorizeCalls != 0 || backend.queryCalled {
				t.Fatalf("inconsistent inspection crossed execution boundary: result=%#v authorize=%d query=%t", result, backend.authorizeCalls, backend.queryCalled)
			}
			if !strings.Contains(firstTextContent(result), "安全检查结果无效") {
				t.Fatalf("unexpected error text: %q", firstTextContent(result))
			}
		})
	}
}

func TestExecuteSQLForwardsRequestContextToBackend(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "postgres-main",
			Config: connection.ConnectionConfig{
				Type:     "postgres",
				Database: "app",
			},
		},
		inspection: appcore.SQLInspection{
			StatementCount: 1,
			ReadOnly:       true,
			Statements: []appcore.SQLStatementInspection{
				{Index: 1, Keyword: "select", ReadOnly: true},
			},
		},
		queryResult: connection.QueryResult{Success: true, Data: []connection.ResultSetData{}},
	}

	requestCtx, cancel := context.WithCancel(context.Background())
	cancel()
	result, _, err := NewService(backend).ExecuteSQL(requestCtx, nil, executeSQLArgs{
		ConnectionID: "postgres-main",
		SQL:          "SELECT 1",
	})
	if err != nil {
		t.Fatalf("ExecuteSQL returned error: %v", err)
	}
	if result == nil || result.IsError || !backend.queryCalled {
		t.Fatalf("ExecuteSQL did not reach the backend: result=%#v called=%t", result, backend.queryCalled)
	}
	if backend.queryContext == nil || backend.queryContext.Err() != context.Canceled {
		t.Fatalf("backend request context = %v, want cancelled request context", backend.queryContext)
	}
}

func TestExecuteSQLExposesUnsupportedCancellationState(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "legacy-main",
			Config: connection.ConnectionConfig{
				Type:     "custom",
				Database: "app",
			},
		},
		inspection: appcore.SQLInspection{
			StatementCount: 1,
			ReadOnly:       true,
			Statements: []appcore.SQLStatementInspection{
				{Index: 1, Keyword: "select", ReadOnly: true},
			},
		},
		queryResult: connection.QueryResult{
			Success:           true,
			Message:           "driver cannot stop the underlying SQL",
			CancellationState: connection.QueryCancellationStateUnsupported,
			Data:              []connection.ResultSetData{},
		},
	}

	result, out, err := NewService(backend).ExecuteSQL(context.Background(), nil, executeSQLArgs{
		ConnectionID: "legacy-main",
		SQL:          "SELECT 1",
	})
	if err != nil {
		t.Fatalf("ExecuteSQL returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected the completed SQL result with explicit cancellation state, got %#v", result)
	}
	if out.CancellationState != connection.QueryCancellationStateUnsupported {
		t.Fatalf("unsupported cancellation state was lost from structured MCP output: %#v", out)
	}
	if text := firstTextContent(result); !strings.Contains(text, "取消状态：unsupported") {
		t.Fatalf("unsupported cancellation state was lost at the MCP boundary: %q", text)
	}
}

func TestExecuteSQLAllowsDDLWhenAISafetyIsFullAndAllowMutating(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		inspection: appcore.SQLInspection{
			StatementCount: 1,
			ReadOnly:       false,
			Statements: []appcore.SQLStatementInspection{
				{Index: 1, Keyword: "drop", ReadOnly: false},
			},
		},
		safetyLevel: ai.PermissionFull,
		queryResult: connection.QueryResult{
			Success: true,
			Data:    []connection.ResultSetData{},
		},
	}

	service := NewService(backend)
	result, _, err := service.ExecuteSQL(context.Background(), nil, executeSQLArgs{
		ConnectionID:  "mysql-main",
		SQL:           "drop table users",
		AllowMutating: true,
	})
	if err != nil {
		t.Fatalf("ExecuteSQL returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected success result, got %#v", result)
	}
	if !backend.queryCalled {
		t.Fatalf("expected SQL to be executed")
	}
}

func TestExecuteSQLAllowsOtherStatementsWhenAISafetyIsFullAndAllowMutating(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "oracle-main",
			Config: connection.ConnectionConfig{
				Type:     "oracle",
				Database: "app",
			},
		},
		inspection: appcore.SQLInspection{
			StatementCount: 1,
			ReadOnly:       false,
			Statements: []appcore.SQLStatementInspection{
				{Index: 1, Keyword: "call", ReadOnly: false},
			},
		},
		safetyLevel: ai.PermissionFull,
		queryResult: connection.QueryResult{
			Success: true,
			Data:    []connection.ResultSetData{},
		},
	}

	service := NewService(backend)
	result, _, err := service.ExecuteSQL(context.Background(), nil, executeSQLArgs{
		ConnectionID:  "oracle-main",
		SQL:           "CALL bulk_insert_users(100000)",
		AllowMutating: true,
	})
	if err != nil {
		t.Fatalf("ExecuteSQL returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected success result, got %#v", result)
	}
	if !backend.queryCalled {
		t.Fatalf("expected SQL to be executed")
	}
}

func TestExecuteSQLNormalizesAndTruncatesResultSets(t *testing.T) {
	backend := &fakeBackend{
		editableConnection: connection.SavedConnectionView{
			ID: "mysql-main",
			Config: connection.ConnectionConfig{
				Type:     "mysql",
				Database: "app",
			},
		},
		inspection: appcore.SQLInspection{
			StatementCount: 1,
			ReadOnly:       true,
			Statements: []appcore.SQLStatementInspection{
				{Index: 1, Keyword: "select", ReadOnly: true},
			},
		},
		queryResult: connection.QueryResult{
			Success: true,
			QueryID: "query-1",
			Data: []connection.ResultSetData{
				{
					StatementIndex: 1,
					Columns:        []string{"id"},
					Rows: []map[string]interface{}{
						{"id": 1},
						{"id": 2},
						{"id": 3},
					},
				},
			},
		},
	}

	service := NewService(backend)
	result, out, err := service.ExecuteSQL(context.Background(), nil, executeSQLArgs{
		ConnectionID:     "mysql-main",
		SQL:              "select id from users",
		MaxRowsPerResult: 2,
	})
	if err != nil {
		t.Fatalf("ExecuteSQL returned error: %v", err)
	}
	if result == nil || result.IsError {
		t.Fatalf("expected success result, got %#v", result)
	}
	if !backend.queryCalled {
		t.Fatalf("expected SQL to be executed")
	}
	if out.StatementCount != 1 || len(out.Results) != 1 {
		t.Fatalf("unexpected output: %#v", out)
	}
	if out.QueryID != "query-1" {
		t.Fatalf("unexpected query id: %q", out.QueryID)
	}
	if !out.Truncated || !out.Results[0].Truncated {
		t.Fatalf("expected truncated result, got %#v", out.Results[0])
	}
	if out.Results[0].RowCount != 3 {
		t.Fatalf("expected rowCount 3, got %d", out.Results[0].RowCount)
	}
	if len(out.Results[0].Rows) != 2 {
		t.Fatalf("expected 2 returned rows, got %d", len(out.Results[0].Rows))
	}
}

func firstTextContent(result *mcp.CallToolResult) string {
	if result == nil || len(result.Content) == 0 {
		return ""
	}
	text, _ := result.Content[0].(*mcp.TextContent)
	if text == nil {
		return ""
	}
	return text.Text
}
