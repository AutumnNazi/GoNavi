package app

import (
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/secretstore"
)

type fakeSchemaDDLDB struct {
	connectConfig connection.ConnectionConfig
	execQueries   []string
}

func (f *fakeSchemaDDLDB) Connect(config connection.ConnectionConfig) error {
	f.connectConfig = config
	return nil
}
func (f *fakeSchemaDDLDB) Close() error { return nil }
func (f *fakeSchemaDDLDB) Ping() error  { return nil }
func (f *fakeSchemaDDLDB) Query(query string) ([]map[string]interface{}, []string, error) {
	return nil, nil, nil
}
func (f *fakeSchemaDDLDB) Exec(query string) (int64, error) {
	f.execQueries = append(f.execQueries, query)
	return 0, nil
}
func (f *fakeSchemaDDLDB) GetDatabases() ([]string, error) { return nil, nil }
func (f *fakeSchemaDDLDB) GetTables(dbName string) ([]string, error) {
	return nil, nil
}
func (f *fakeSchemaDDLDB) GetCreateStatement(dbName, tableName string) (string, error) {
	return "", nil
}
func (f *fakeSchemaDDLDB) GetColumns(dbName, tableName string) ([]connection.ColumnDefinition, error) {
	return nil, nil
}
func (f *fakeSchemaDDLDB) GetAllColumns(dbName string) ([]connection.ColumnDefinitionWithTable, error) {
	return nil, nil
}
func (f *fakeSchemaDDLDB) GetIndexes(dbName, tableName string) ([]connection.IndexDefinition, error) {
	return nil, nil
}
func (f *fakeSchemaDDLDB) GetForeignKeys(dbName, tableName string) ([]connection.ForeignKeyDefinition, error) {
	return nil, nil
}
func (f *fakeSchemaDDLDB) GetTriggers(dbName, tableName string) ([]connection.TriggerDefinition, error) {
	return nil, nil
}

var _ db.Database = (*fakeSchemaDDLDB)(nil)

func TestBuildRenameSchemaSQL_PostgresQuotesIdentifiers(t *testing.T) {
	got, err := buildRenameSchemaSQL("postgresql", `sales"old`, `sales"new`)
	if err != nil {
		t.Fatalf("expected postgres rename schema SQL, got error: %v", err)
	}
	const want = `ALTER SCHEMA "sales""old" RENAME TO "sales""new"`
	if got != want {
		t.Fatalf("unexpected rename schema SQL, want %q got %q", want, got)
	}
}

func TestBuildRenameSchemaSQL_PostgresAllowsCaseOnlyRename(t *testing.T) {
	got, err := buildRenameSchemaSQL("postgresql", "sales", "SALES")
	if err != nil {
		t.Fatalf("expected postgres case-only schema rename SQL, got error: %v", err)
	}
	const want = `ALTER SCHEMA "sales" RENAME TO "SALES"`
	if got != want {
		t.Fatalf("unexpected case-only rename schema SQL, want %q got %q", want, got)
	}
}

func TestBuildDropSchemaSQL_PostgresUsesCascade(t *testing.T) {
	got, err := buildDropSchemaSQL("postgresql", `sales"ops`)
	if err != nil {
		t.Fatalf("expected postgres drop schema SQL, got error: %v", err)
	}
	const want = `DROP SCHEMA "sales""ops" CASCADE`
	if got != want {
		t.Fatalf("unexpected drop schema SQL, want %q got %q", want, got)
	}
}

func TestRenameSchema_CustomPostgresUsesSelectedDatabase(t *testing.T) {
	originalNewDatabaseFunc := newDatabaseFunc
	originalResolveDialConfigWithProxyFunc := resolveDialConfigWithProxyFunc
	t.Cleanup(func() {
		newDatabaseFunc = originalNewDatabaseFunc
		resolveDialConfigWithProxyFunc = originalResolveDialConfigWithProxyFunc
	})

	fakeDB := &fakeSchemaDDLDB{}
	newDatabaseFunc = func(dbType string) (db.Database, error) {
		return fakeDB, nil
	}
	resolveDialConfigWithProxyFunc = func(raw connection.ConnectionConfig) (connection.ConnectionConfig, error) {
		return raw, nil
	}

	app := NewAppWithSecretStore(secretstore.NewUnavailableStore("test"))
	result := app.RenameSchema(connection.ConnectionConfig{
		Type:     "custom",
		Driver:   "pgx",
		Database: "postgres",
	}, "tenant_db", "sales", `sales"2026`)

	if !result.Success {
		t.Fatalf("expected rename schema success, got failure: %s", result.Message)
	}
	if fakeDB.connectConfig.Database != "tenant_db" {
		t.Fatalf("expected rename schema connection to use selected database tenant_db, got %q", fakeDB.connectConfig.Database)
	}
	if len(fakeDB.execQueries) != 1 {
		t.Fatalf("expected one rename schema statement, got %d: %#v", len(fakeDB.execQueries), fakeDB.execQueries)
	}
	const want = `ALTER SCHEMA "sales" RENAME TO "sales""2026"`
	if fakeDB.execQueries[0] != want {
		t.Fatalf("unexpected rename schema SQL, want %q got %q", want, fakeDB.execQueries[0])
	}
}

func TestDropSchema_CustomPostgresUsesCascade(t *testing.T) {
	originalNewDatabaseFunc := newDatabaseFunc
	originalResolveDialConfigWithProxyFunc := resolveDialConfigWithProxyFunc
	t.Cleanup(func() {
		newDatabaseFunc = originalNewDatabaseFunc
		resolveDialConfigWithProxyFunc = originalResolveDialConfigWithProxyFunc
	})

	fakeDB := &fakeSchemaDDLDB{}
	newDatabaseFunc = func(dbType string) (db.Database, error) {
		return fakeDB, nil
	}
	resolveDialConfigWithProxyFunc = func(raw connection.ConnectionConfig) (connection.ConnectionConfig, error) {
		return raw, nil
	}

	app := NewAppWithSecretStore(secretstore.NewUnavailableStore("test"))
	result := app.DropSchema(connection.ConnectionConfig{
		Type:     "custom",
		Driver:   "pgx",
		Database: "postgres",
	}, "tenant_db", `sales"ops`)

	if !result.Success {
		t.Fatalf("expected drop schema success, got failure: %s", result.Message)
	}
	if fakeDB.connectConfig.Database != "tenant_db" {
		t.Fatalf("expected drop schema connection to use selected database tenant_db, got %q", fakeDB.connectConfig.Database)
	}
	if len(fakeDB.execQueries) != 1 {
		t.Fatalf("expected one drop schema statement, got %d: %#v", len(fakeDB.execQueries), fakeDB.execQueries)
	}
	const want = `DROP SCHEMA "sales""ops" CASCADE`
	if fakeDB.execQueries[0] != want {
		t.Fatalf("unexpected drop schema SQL, want %q got %q", want, fakeDB.execQueries[0])
	}
}
