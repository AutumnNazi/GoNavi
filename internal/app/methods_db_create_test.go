package app

import (
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/secretstore"
)

type fakeCreateDatabaseDB struct {
	connectConfig    connection.ConnectionConfig
	execQueries      []string
	applyChanges     connection.ChangeSet
	applyTableName   string
	previewTableName string
	previewDeletes   []string
	previewUpdates   []string
	previewInserts   []string
}

func (f *fakeCreateDatabaseDB) Connect(config connection.ConnectionConfig) error {
	f.connectConfig = config
	return nil
}
func (f *fakeCreateDatabaseDB) Close() error { return nil }
func (f *fakeCreateDatabaseDB) Ping() error  { return nil }
func (f *fakeCreateDatabaseDB) Query(query string) ([]map[string]interface{}, []string, error) {
	return nil, nil, nil
}
func (f *fakeCreateDatabaseDB) Exec(query string) (int64, error) {
	f.execQueries = append(f.execQueries, query)
	return 0, nil
}
func (f *fakeCreateDatabaseDB) GetDatabases() ([]string, error) { return nil, nil }
func (f *fakeCreateDatabaseDB) GetTables(dbName string) ([]string, error) {
	return nil, nil
}
func (f *fakeCreateDatabaseDB) GetCreateStatement(dbName, tableName string) (string, error) {
	return "", nil
}
func (f *fakeCreateDatabaseDB) GetColumns(dbName, tableName string) ([]connection.ColumnDefinition, error) {
	return nil, nil
}
func (f *fakeCreateDatabaseDB) GetAllColumns(dbName string) ([]connection.ColumnDefinitionWithTable, error) {
	return nil, nil
}
func (f *fakeCreateDatabaseDB) GetIndexes(dbName, tableName string) ([]connection.IndexDefinition, error) {
	return nil, nil
}
func (f *fakeCreateDatabaseDB) GetForeignKeys(dbName, tableName string) ([]connection.ForeignKeyDefinition, error) {
	return nil, nil
}
func (f *fakeCreateDatabaseDB) GetTriggers(dbName, tableName string) ([]connection.TriggerDefinition, error) {
	return nil, nil
}
func (f *fakeCreateDatabaseDB) ApplyChanges(tableName string, changes connection.ChangeSet) error {
	f.applyTableName = tableName
	f.applyChanges = changes
	return nil
}
func (f *fakeCreateDatabaseDB) PreviewChanges(tableName string, changes connection.ChangeSet) (deletes, updates, inserts []string) {
	f.previewTableName = tableName
	return f.previewDeletes, f.previewUpdates, f.previewInserts
}

var _ db.Database = (*fakeCreateDatabaseDB)(nil)
var _ db.BatchApplier = (*fakeCreateDatabaseDB)(nil)
var _ db.ChangePreviewer = (*fakeCreateDatabaseDB)(nil)

func TestResolveDDLDBType_SQLServerAliases(t *testing.T) {
	tests := []connection.ConnectionConfig{
		{Type: "sqlserver"},
		{Type: "mssql"},
		{Type: "sql_server"},
		{Type: "custom", Driver: "mssql"},
		{Type: "custom", Driver: "sql-server"},
	}

	for _, cfg := range tests {
		if got := resolveDDLDBType(cfg); got != "sqlserver" {
			t.Fatalf("resolveDDLDBType(%+v) = %q, want sqlserver", cfg, got)
		}
	}
}

func TestBuildRunConfigForDDL_CustomSQLServerUsesDatabase(t *testing.T) {
	got := buildRunConfigForDDL(connection.ConnectionConfig{
		Type:     "custom",
		Driver:   "mssql",
		Database: "master",
	}, "sqlserver", "target_db")
	if got.Database != "target_db" {
		t.Fatalf("expected custom SQL Server DDL database target_db, got %q", got.Database)
	}
}

func TestCreateDatabase_SQLServerUsesBracketIdentifiers(t *testing.T) {
	originalNewDatabaseFunc := newDatabaseFunc
	originalResolveDialConfigWithProxyFunc := resolveDialConfigWithProxyFunc
	t.Cleanup(func() {
		newDatabaseFunc = originalNewDatabaseFunc
		resolveDialConfigWithProxyFunc = originalResolveDialConfigWithProxyFunc
	})

	fakeDB := &fakeCreateDatabaseDB{}
	newDatabaseFunc = func(dbType string) (db.Database, error) {
		return fakeDB, nil
	}
	resolveDialConfigWithProxyFunc = func(raw connection.ConnectionConfig) (connection.ConnectionConfig, error) {
		return raw, nil
	}

	app := NewAppWithSecretStore(secretstore.NewUnavailableStore("test"))
	result := app.CreateDatabase(connection.ConnectionConfig{
		Type:     "custom",
		Driver:   "mssql",
		Database: "master",
	}, "lg")

	if !result.Success {
		t.Fatalf("expected SQL Server create database success, got failure: %s", result.Message)
	}
	if fakeDB.connectConfig.Database != "" {
		t.Fatalf("expected create database connection to clear database and use default master, got %q", fakeDB.connectConfig.Database)
	}
	if len(fakeDB.execQueries) != 1 {
		t.Fatalf("expected one create database statement, got %d: %#v", len(fakeDB.execQueries), fakeDB.execQueries)
	}
	const want = "CREATE DATABASE [lg]"
	if fakeDB.execQueries[0] != want {
		t.Fatalf("unexpected SQL Server create database SQL, want %q got %q", want, fakeDB.execQueries[0])
	}
}

func TestBuildCreateSchemaSQL_PostgresQuotesSchemaName(t *testing.T) {
	got, err := buildCreateSchemaSQL("postgresql", `sales"Ops`)
	if err != nil {
		t.Fatalf("expected postgres create schema SQL, got error: %v", err)
	}
	const want = `CREATE SCHEMA "sales""Ops"`
	if got != want {
		t.Fatalf("unexpected create schema SQL, want %q got %q", want, got)
	}
}

func TestBuildCreateSchemaSQL_RejectsUnsupportedDatabaseType(t *testing.T) {
	if _, err := buildCreateSchemaSQL("mysql", "sales"); err == nil {
		t.Fatalf("expected unsupported database type error")
	}
}

func TestCreateSchema_CustomPostgresUsesSelectedDatabase(t *testing.T) {
	originalNewDatabaseFunc := newDatabaseFunc
	originalResolveDialConfigWithProxyFunc := resolveDialConfigWithProxyFunc
	t.Cleanup(func() {
		newDatabaseFunc = originalNewDatabaseFunc
		resolveDialConfigWithProxyFunc = originalResolveDialConfigWithProxyFunc
	})

	fakeDB := &fakeCreateDatabaseDB{}
	newDatabaseFunc = func(dbType string) (db.Database, error) {
		return fakeDB, nil
	}
	resolveDialConfigWithProxyFunc = func(raw connection.ConnectionConfig) (connection.ConnectionConfig, error) {
		return raw, nil
	}

	app := NewAppWithSecretStore(secretstore.NewUnavailableStore("test"))
	result := app.CreateSchema(connection.ConnectionConfig{
		Type:     "custom",
		Driver:   "pgx",
		Database: "postgres",
	}, "tenant_db", `tenant"schema`)

	if !result.Success {
		t.Fatalf("expected create schema success, got failure: %s", result.Message)
	}
	if fakeDB.connectConfig.Database != "tenant_db" {
		t.Fatalf("expected create schema connection to use selected database tenant_db, got %q", fakeDB.connectConfig.Database)
	}
	if len(fakeDB.execQueries) != 1 {
		t.Fatalf("expected one create schema statement, got %d: %#v", len(fakeDB.execQueries), fakeDB.execQueries)
	}
	const want = `CREATE SCHEMA "tenant""schema"`
	if fakeDB.execQueries[0] != want {
		t.Fatalf("unexpected create schema SQL, want %q got %q", want, fakeDB.execQueries[0])
	}
}
