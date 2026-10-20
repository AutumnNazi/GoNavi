package app

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	syncengine "GoNavi-Wails/internal/sync"
	"GoNavi-Wails/internal/syncjob"
)

var errUnknownDatabaseForTest = errors.New("Error 1049 (42000): Unknown database")

type targetDatabaseFakeDB struct {
	fakeMetadataRetryDB
	mu        sync.Mutex
	databases []string
	execs     []string
}

func (f *targetDatabaseFakeDB) GetDatabases() ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.databases...), nil
}

func (f *targetDatabaseFakeDB) Exec(query string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.execs = append(f.execs, query)
	return 0, nil
}

func (f *targetDatabaseFakeDB) executed() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.execs...)
}

func setupTargetDatabaseApp(t *testing.T, databases ...string) (*App, *targetDatabaseFakeDB) {
	t.Helper()
	installFakeOptionalDriverRuntime(t)
	fake := &targetDatabaseFakeDB{databases: databases}
	originalNewDatabaseFunc := newDatabaseFunc
	originalResolveDialConfigWithProxyFunc := resolveDialConfigWithProxyFunc
	newDatabaseFunc = func(string) (db.Database, error) { return fake, nil }
	resolveDialConfigWithProxyFunc = func(config connection.ConnectionConfig) (connection.ConnectionConfig, error) {
		return config, nil
	}
	t.Cleanup(func() {
		newDatabaseFunc = originalNewDatabaseFunc
		resolveDialConfigWithProxyFunc = originalResolveDialConfigWithProxyFunc
	})
	application := NewAppWithSecretStore(newFakeAppSecretStore())
	application.configDir = t.TempDir()
	t.Cleanup(application.Shutdown)
	return application, fake
}

func mysqlTargetEndpoint(database string) resolvedDataSyncJobEndpoint {
	return resolvedDataSyncJobEndpoint{
		Config:   connection.ConnectionConfig{Type: "mysql", Host: "127.0.0.1", Port: 3306, User: "root"},
		Database: database,
	}
}

func TestDataSyncTargetDatabaseTypeRules(t *testing.T) {
	cases := []struct {
		dbType    string
		required  bool
		creatable bool
	}{
		{"mysql", true, true},
		{"mariadb", true, true},
		{"postgres", false, true},
		{"sqlserver", false, true},
		{"oracle", false, false},
		{"sqlite", false, false},
	}
	for _, tc := range cases {
		config := connection.ConnectionConfig{Type: tc.dbType}
		if got := dataSyncTargetDatabaseRequired(config); got != tc.required {
			t.Errorf("%s required = %v, want %v", tc.dbType, got, tc.required)
		}
		if got := dataSyncTargetDatabaseCreatable(config); got != tc.creatable {
			t.Errorf("%s creatable = %v, want %v", tc.dbType, got, tc.creatable)
		}
	}
}

func TestPreflightDataSyncTargetDatabase(t *testing.T) {
	cases := []struct {
		name        string
		kind        syncjob.JobKind
		database    string
		wantCode    string
		wantPending bool
	}{
		{name: "empty database on mysql blocks", kind: syncjob.JobKindMigration, database: "", wantCode: "target_database_required"},
		{name: "existing database passes", kind: syncjob.JobKindMigration, database: "my_lease"},
		{name: "existing database matches case-insensitively", kind: syncjob.JobKindReconcile, database: "MY_LEASE"},
		{name: "missing database is created by migration", kind: syncjob.JobKindMigration, database: "new_db", wantCode: "target_database_will_be_created", wantPending: true},
		{name: "missing database blocks reconcile", kind: syncjob.JobKindReconcile, database: "new_db", wantCode: "target_database_missing"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			application, _ := setupTargetDatabaseApp(t, "information_schema", "my_lease")
			target := mysqlTargetEndpoint(tc.database)
			issues := application.preflightDataSyncTargetDatabase(context.Background(), syncjob.JobDefinition{Kind: tc.kind}, &target)
			if tc.wantCode == "" {
				if len(issues) != 0 {
					t.Fatalf("issues = %+v, want none", issues)
				}
			} else if len(issues) != 1 || issues[0].Code != tc.wantCode {
				t.Fatalf("issues = %+v, want single %s", issues, tc.wantCode)
			}
			if target.DatabasePending != tc.wantPending {
				t.Fatalf("DatabasePending = %v, want %v", target.DatabasePending, tc.wantPending)
			}
		})
	}
}

func TestPreflightDataSyncTargetDatabaseRespectsReadOnlyTarget(t *testing.T) {
	application, _ := setupTargetDatabaseApp(t, "my_lease")
	target := mysqlTargetEndpoint("new_db")
	target.Config.Protection = connection.ConnectionProtectionConfig{RestrictStructureEdit: true}
	issues := application.preflightDataSyncTargetDatabase(context.Background(), syncjob.JobDefinition{Kind: syncjob.JobKindMigration}, &target)
	if len(issues) != 1 || issues[0].Code != "target_protection_blocked" || issues[0].Severity != DataSyncJobPreflightBlocker {
		t.Fatalf("issues = %+v, want target_protection_blocked blocker", issues)
	}
	if target.DatabasePending {
		t.Fatal("a protected target must not be marked for creation")
	}
}

func TestEnsureDataSyncTargetDatabase(t *testing.T) {
	cases := []struct {
		name     string
		kind     syncjob.JobKind
		database string
		wantExec bool
	}{
		{name: "migration creates missing database", kind: syncjob.JobKindMigration, database: "new_db", wantExec: true},
		{name: "migration leaves existing database alone", kind: syncjob.JobKindMigration, database: "my_lease"},
		{name: "reconcile never creates databases", kind: syncjob.JobKindReconcile, database: "new_db"},
		{name: "empty database is a no-op", kind: syncjob.JobKindMigration, database: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			application, fake := setupTargetDatabaseApp(t, "my_lease")
			err := application.ensureDataSyncTargetDatabase(context.Background(), syncjob.JobDefinition{Kind: tc.kind}, mysqlTargetEndpoint(tc.database))
			if err != nil {
				t.Fatalf("ensureDataSyncTargetDatabase: %v", err)
			}
			created := false
			for _, statement := range fake.executed() {
				if strings.HasPrefix(statement, "CREATE DATABASE") {
					created = true
					if !strings.Contains(statement, "`"+tc.database+"`") {
						t.Fatalf("statement %q does not target %s", statement, tc.database)
					}
				}
			}
			if created != tc.wantExec {
				t.Fatalf("created = %v, want %v (execs=%v)", created, tc.wantExec, fake.executed())
			}
		})
	}
}

func TestDataSyncObjectListTreatsMissingDatabaseAsEmpty(t *testing.T) {
	application, fake := setupTargetDatabaseApp(t, "my_lease")
	fake.tablesErr = errUnknownDatabaseForTest
	if _, err := application.SaveConnection(connection.SavedConnectionInput{
		ID: "target", Name: "target",
		Config: connection.ConnectionConfig{ID: "target", Type: "mysql", Host: "127.0.0.1", Port: 3306, User: "root"},
	}); err != nil {
		t.Fatal(err)
	}
	result := application.DataSyncObjectList("target", "new_db", "")
	if !result.Success {
		t.Fatalf("missing database should list as empty, got %q", result.Message)
	}
	if rows, ok := result.Data.([]map[string]string); !ok || len(rows) != 0 {
		t.Fatalf("data = %#v, want empty table list", result.Data)
	}

	existing := application.DataSyncObjectList("target", "my_lease", "")
	if existing.Success {
		t.Fatal("a listing failure on an existing database must still surface")
	}
}

func TestPreflightMigrationIntoMissingDatabasePlansCreation(t *testing.T) {
	application, fake := setupTargetDatabaseApp(t, "my_lease")
	fake.columns = []connection.ColumnDefinition{{Name: "id", Type: "bigint", Key: "PRI"}}
	for _, input := range []connection.SavedConnectionInput{
		{ID: "source", Name: "source", Config: connection.ConnectionConfig{ID: "source", Type: "mysql", Host: "remote.local", Port: 3306, User: "root", Database: "my_lease"}},
		{ID: "target", Name: "target", Config: connection.ConnectionConfig{ID: "target", Type: "mysql", Host: "127.0.0.1", Port: 3306, User: "root"}},
	} {
		if _, err := application.SaveConnection(input); err != nil {
			t.Fatal(err)
		}
	}
	definition := syncjob.JobDefinition{
		Name:            "migrate into new database",
		Lifecycle:       syncjob.JobLifecycleReady,
		Kind:            syncjob.JobKindMigration,
		IncrementalMode: syncjob.IncrementalSnapshot,
		Source:          syncjob.EndpointRef{ConnectionID: "source", Database: "my_lease"},
		Target:          syncjob.EndpointRef{ConnectionID: "target", Database: "my_lease_local"},
		Mappings: []syncjob.TableMapping{
			{SourceTable: "orders", TargetTable: "orders", Enabled: true},
			{SourceTable: "customers", TargetTable: "customers", Enabled: true},
		},
		Options: syncjob.ExecutionOptions{
			Content:             "both",
			SyncMode:            "insert_update",
			TargetTableStrategy: "smart",
			BatchSize:           1000,
			ErrorPolicy:         syncjob.ErrorPolicyStop,
			RetryBackoffMillis:  500,
		},
		Schedule: syncjob.ScheduleSpec{Kind: syncjob.ScheduleManual},
	}
	result := application.preflightDataSyncJobContext(context.Background(), definition, time.Now())
	codes := map[string]int{}
	for _, issue := range result.Issues {
		codes[issue.Code]++
		if issue.Severity == DataSyncJobPreflightBlocker {
			t.Errorf("unexpected blocker %s: %s", issue.Code, issue.Message)
		}
		if strings.Contains(issue.Message, "1046") || strings.Contains(issue.Message, "1049") {
			t.Errorf("issue %s leaked a missing-database driver error: %s", issue.Code, issue.Message)
		}
	}
	if codes["target_database_will_be_created"] != 1 {
		t.Fatalf("codes = %v, want one target_database_will_be_created", codes)
	}
	if codes["target_table_will_be_created"] != 2 {
		t.Fatalf("codes = %v, want target_table_will_be_created for both mappings", codes)
	}
}

func TestDataSyncJobMappingCanCreateTarget(t *testing.T) {
	capability := syncengineCapabilityForTest()
	reconcile := func(strategy string, mode syncjob.IncrementalMode) syncjob.JobDefinition {
		return syncjob.JobDefinition{
			Kind:            syncjob.JobKindReconcile,
			IncrementalMode: mode,
			Options:         syncjob.ExecutionOptions{Content: "data", TargetTableStrategy: strategy},
		}
	}
	keyed := syncjob.TableMapping{SourceTable: "orders", TargetTable: "orders", KeyColumns: []string{"id"}}
	cases := []struct {
		name       string
		definition syncjob.JobDefinition
		mapping    syncjob.TableMapping
		want       bool
	}{
		{"reconcile with keys creates missing tables", reconcile("smart", syncjob.IncrementalSnapshot), keyed, true},
		{"reconcile watermark creates missing tables", reconcile("smart", syncjob.IncrementalWatermark), keyed, true},
		{"reconcile existing_only never creates", reconcile("existing_only", syncjob.IncrementalSnapshot), keyed, false},
		{"cdc never creates", reconcile("smart", syncjob.IncrementalCDC), keyed, false},
		{"explicit field mapping cannot be derived from source", reconcile("smart", syncjob.IncrementalSnapshot), syncjob.TableMapping{
			SourceTable: "orders", TargetTable: "orders", KeyColumns: []string{"id"},
			Columns: []syncjob.ColumnMapping{{Source: "name", Target: "full_name"}},
		}, false},
		{"query sink never creates", syncjob.JobDefinition{Kind: syncjob.JobKindQuerySink, Options: syncjob.ExecutionOptions{TargetTableStrategy: "smart"}}, keyed, false},
	}
	for _, tc := range cases {
		if got := dataSyncJobMappingCanCreateTarget(tc.definition, tc.mapping, capability); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestBuildDataSyncJobTargetCreateConfigIsSchemaOnly(t *testing.T) {
	definition := syncjob.JobDefinition{
		Kind:            syncjob.JobKindReconcile,
		IncrementalMode: syncjob.IncrementalWatermark,
		Options:         syncjob.ExecutionOptions{Content: "data", SyncMode: "insert_update", TargetTableStrategy: "smart", PropagateDeletes: true},
	}
	mapping := syncjob.TableMapping{
		SourceTable: "orders", TargetTable: "orders_copy", KeyColumns: []string{"id"},
		Watermark: &syncjob.WatermarkSpec{Column: "updated_at"},
	}
	config, err := buildDataSyncJobTargetCreateConfig(definition, "run", mysqlTargetEndpoint("src"), mysqlTargetEndpoint("dst"), mapping)
	if err != nil {
		t.Fatalf("buildDataSyncJobTargetCreateConfig: %v", err)
	}
	if config.Content != "schema" || config.TargetTableStrategy != "smart" || config.AutoAddColumns || !config.CreateIndexes {
		t.Fatalf("create config = content %q strategy %q autoAdd %v, want schema-only smart create", config.Content, config.TargetTableStrategy, config.AutoAddColumns)
	}
	if len(config.Mappings) != 1 || config.Mappings[0].Target.Name != "orders_copy" || len(config.Mappings[0].Columns) != 0 {
		t.Fatalf("create config must keep the renamed identity mapping, got %#v", config.Mappings)
	}

	data, err := buildDataSyncJobEngineConfig(definition, "run", mysqlTargetEndpoint("src"), mysqlTargetEndpoint("dst"), mapping)
	if err != nil {
		t.Fatalf("buildDataSyncJobEngineConfig: %v", err)
	}
	if data.TargetTableStrategy != "existing_only" || data.CreateIndexes {
		t.Fatalf("sync data stage must only write existing tables, got strategy %q createIndexes %v", data.TargetTableStrategy, data.CreateIndexes)
	}
}

func TestPreflightSyncIntoMissingDatabasePlansCreation(t *testing.T) {
	application, fake := setupTargetDatabaseApp(t, "my_lease")
	fake.columns = []connection.ColumnDefinition{{Name: "id", Type: "bigint", Key: "PRI"}}
	for _, input := range []connection.SavedConnectionInput{
		{ID: "source", Name: "source", Config: connection.ConnectionConfig{ID: "source", Type: "mysql", Host: "remote.local", Port: 3306, User: "root", Database: "my_lease"}},
		{ID: "target", Name: "target", Config: connection.ConnectionConfig{ID: "target", Type: "mysql", Host: "127.0.0.1", Port: 3306, User: "root"}},
	} {
		if _, err := application.SaveConnection(input); err != nil {
			t.Fatal(err)
		}
	}
	definition := syncjob.JobDefinition{
		Name:            "sync into new database",
		Lifecycle:       syncjob.JobLifecycleReady,
		Kind:            syncjob.JobKindReconcile,
		IncrementalMode: syncjob.IncrementalSnapshot,
		Source:          syncjob.EndpointRef{ConnectionID: "source", Database: "my_lease"},
		Target:          syncjob.EndpointRef{ConnectionID: "target", Database: "my_lease_local"},
		Mappings: []syncjob.TableMapping{
			{SourceTable: "orders", TargetTable: "orders", KeyColumns: []string{"id"}, TargetTableStrategy: "smart", Enabled: true},
		},
		Options: syncjob.ExecutionOptions{
			Content:             "data",
			SyncMode:            "insert_update",
			TargetTableStrategy: "smart",
			BatchSize:           1000,
			ErrorPolicy:         syncjob.ErrorPolicyStop,
			RetryBackoffMillis:  500,
		},
		Schedule: syncjob.ScheduleSpec{Kind: syncjob.ScheduleManual},
	}
	result := application.preflightDataSyncJobContext(context.Background(), definition, time.Now())
	codes := map[string]int{}
	for _, issue := range result.Issues {
		codes[issue.Code]++
		if issue.Severity == DataSyncJobPreflightBlocker {
			t.Errorf("unexpected blocker %s: %s", issue.Code, issue.Message)
		}
	}
	if codes["target_database_will_be_created"] != 1 || codes["target_table_will_be_created"] != 1 {
		t.Fatalf("codes = %v, want database and table creation planned", codes)
	}
}

func syncengineCapabilityForTest() syncengine.MigrationCapability {
	return syncengine.ResolveMigrationCapability(
		connection.ConnectionConfig{Type: "mysql"},
		connection.ConnectionConfig{Type: "mysql"},
	)
}
