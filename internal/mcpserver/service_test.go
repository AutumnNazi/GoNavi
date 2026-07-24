package mcpserver

import (
	"context"
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

func (f *fakeBackend) ExecuteSQLFromMCP(config connection.ConnectionConfig, dbName string, query string) connection.QueryResult {
	f.queryCalled = true
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
