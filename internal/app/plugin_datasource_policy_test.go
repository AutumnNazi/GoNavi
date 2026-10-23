package app

import (
	"encoding/json"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestPluginDataSourcePolicyIdentity(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		value     string
		namespace bool
		dialect   string
	}{
		{name: "mysql", value: "plugin:example.reader:source:mysql", namespace: true, dialect: "mysql"},
		{name: "postgres", value: "plugin:example.reader:source:postgres", namespace: true, dialect: "postgres"},
		{name: "sqlite", value: "plugin:example.reader:source:sqlite", namespace: true, dialect: "sqlite"},
		{name: "missing plugin", value: "plugin:missing.reader:source:postgres", namespace: true, dialect: "postgres"},
		{name: "empty namespace", value: "plugin:", namespace: true},
		{name: "missing source", value: "plugin:example.reader::mysql", namespace: true},
		{name: "missing plugin id", value: "plugin::source:mysql", namespace: true},
		{name: "missing dialect", value: "plugin:example.reader:source:", namespace: true},
		{name: "missing suffix", value: "plugin:example.reader:source", namespace: true},
		{name: "extra suffix", value: "plugin:example.reader:source:mysql:postgres", namespace: true},
		{name: "dialect alias", value: "plugin:example.reader:source:postgresql", namespace: true},
		{name: "unknown dialect", value: "plugin:example.reader:source:oracle", namespace: true},
		{name: "forged prefix casing", value: "PlUgIn:example.reader:source:mysql", namespace: true},
		{name: "forged plugin casing", value: "plugin:Example.reader:source:mysql", namespace: true},
		{name: "forged source casing", value: "plugin:example.reader:Source:mysql", namespace: true},
		{name: "forged dialect casing", value: "plugin:example.reader:source:MYSQL", namespace: true},
		{name: "padded identity", value: " \tplugin:example.reader:source:mysql\r\n", namespace: true},
		{name: "invalid plugin id", value: "plugin:reader:source:mysql", namespace: true},
		{name: "oversized identity", value: "plugin:" + strings.Repeat("a", 129) + ".reader:source:mysql", namespace: true},
		{name: "builtin", value: "mysql"},
		{name: "custom", value: "custom"},
		{name: "empty", value: ""},
		{name: "bare word", value: "plugin", namespace: true},
		{name: "padded bare namespace", value: " PlUgIn ", namespace: true},
		{name: "different prefix", value: "plugins:example.reader:source:mysql"},
		{name: "embedded prefix", value: "other-plugin:example.reader:source:mysql"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := isPluginDataSourceType(test.value); got != test.namespace {
				t.Fatalf("namespace detection = %v, want %v", got, test.namespace)
			}
			dialect, ok := pluginDataSourceDialect(test.value)
			if dialect != test.dialect || ok != (test.dialect != "") {
				t.Fatalf("strict dialect = (%q, %v), want (%q, %v)", dialect, ok, test.dialect, test.dialect != "")
			}
			if !test.namespace {
				return
			}
			want := test.dialect
			if want == "" {
				want = invalidPluginDataSourceDialect
			}
			config := connection.ConnectionConfig{Type: test.value, Driver: "mysql"}
			for name, resolve := range map[string]func(connection.ConnectionConfig) string{
				"protection": resolveConnectionProtectionDBType,
				"DDL":        resolveDDLDBType,
				"classifier": func(config connection.ConnectionConfig) string { return normalizeSQLClassifierDBType(config.Type) },
			} {
				if got := resolve(config); got != want {
					t.Errorf("%s dialect = %q, want %q", name, got, want)
				}
			}
		})
	}
}

func TestPluginDataSourcePolicyForcesProtection(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		saved string
	}{
		{name: "missing flags", saved: `{"type":"plugin:example.reader:source:mysql"}`},
		{name: "legacy false", saved: `{"type":"plugin:example.reader:source:postgres","readOnly":false}`},
		{name: "all protections false", saved: `{"type":"plugin:example.reader:source:sqlite","readOnly":false,"protection":{"restrictDataEdit":false,"restrictStructureEdit":false,"restrictScriptExecution":false,"restrictDataImport":false}}`},
		{name: "partial protections", saved: `{"type":"plugin:example.reader:source:mysql","protection":{"restrictDataEdit":true}}`},
		{name: "legacy true with partial protections", saved: `{"type":"plugin:example.reader:source:mysql","readOnly":true,"protection":{"restrictDataImport":true}}`},
		{name: "disabled identity", saved: `{"type":"plugin:disabled.reader:source:mysql","readOnly":false}`},
		{name: "missing identity", saved: `{"type":"plugin:missing.reader:source:postgres","readOnly":false}`},
		{name: "empty namespace", saved: `{"type":"plugin:","readOnly":false}`},
		{name: "malformed identity", saved: `{"type":"plugin:example.reader::mysql","readOnly":false}`},
		{name: "unknown suffix", saved: `{"type":"plugin:example.reader:source:unknown","readOnly":false}`},
		{name: "forged casing", saved: `{"type":" PLUGIN:example.reader:source:MYSQL ","readOnly":false}`},
	}
	want := connection.ConnectionProtectionConfig{
		RestrictDataEdit: true, RestrictStructureEdit: true,
		RestrictScriptExecution: true, RestrictDataImport: true,
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			var config connection.ConnectionConfig
			if err := json.Unmarshal([]byte(test.saved), &config); err != nil {
				t.Fatal(err)
			}
			if !supportsConnectionReadOnlyMode(config) || !isConnectionForcedReadOnly(config) {
				t.Fatal("plugin namespace lost forced protection")
			}
			if got := resolveConnectionProtectionConfig(config); got != want {
				t.Fatalf("protection = %+v, want %+v", got, want)
			}
			for _, key := range []connectionProtectionKey{
				connectionProtectionDataEdit, connectionProtectionStructureEdit,
				connectionProtectionScriptExecution, connectionProtectionDataImport,
			} {
				if !isConnectionProtectionEnabled(config, key) {
					t.Errorf("%s protection is disabled", key)
				}
				if err := ensureConnectionAllowsActionWithText(config, key, "", pluginPolicyTestText); err == nil {
					t.Errorf("%s action was allowed", key)
				}
			}
			if err := ensureConnectionAllowsQueryWithText(config, "DELETE FROM users", pluginPolicyTestText); err == nil {
				t.Fatal("saved flags allowed a plugin write")
			}
			if test.name == "missing flags" || test.name == "legacy false" || test.name == "all protections false" {
				if err := ensureConnectionAllowsQueryWithText(config, "SELECT 1", pluginPolicyTestText); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestPluginDataSourcePolicyBuiltinDialectsUnchanged(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		config     connection.ConnectionConfig
		protection string
		ddl        string
	}{
		{name: "mysql", config: connection.ConnectionConfig{Type: "MySQL"}, protection: "mysql", ddl: "mysql"},
		{name: "postgres alias", config: connection.ConnectionConfig{Type: " PostgreSQL "}, protection: "postgres", ddl: "postgres"},
		{name: "sqlserver alias", config: connection.ConnectionConfig{Type: "sql-server"}, protection: "sqlserver", ddl: "sqlserver"},
		{name: "doris alias", config: connection.ConnectionConfig{Type: "doris"}, protection: "diros", ddl: "diros"},
		{name: "goldendb separate dialects", config: connection.ConnectionConfig{Type: "greatdb"}, protection: "goldendb", ddl: "mysql"},
		{name: "iris alias", config: connection.ConnectionConfig{Type: "InterSystemsIRIS"}, protection: "iris", ddl: "iris"},
		{name: "custom postgres", config: connection.ConnectionConfig{Type: "custom", Driver: "postgres-driver"}, protection: "postgres", ddl: "postgres"},
		{name: "custom sqlite", config: connection.ConnectionConfig{Type: "custom", Driver: "sqlite3"}, protection: "sqlite", ddl: "sqlite"},
		{name: "custom goldendb", config: connection.ConnectionConfig{Type: "custom", Driver: "gdb"}, protection: "goldendb", ddl: "mysql"},
		{name: "custom unknown", config: connection.ConnectionConfig{Type: "custom", Driver: "other"}, protection: "other", ddl: "other"},
		{name: "oceanbase oracle", config: connection.ConnectionConfig{Type: "oceanbase", OceanBaseProtocol: "oracle"}, protection: "oracle", ddl: "oracle"},
		{name: "unknown type", config: connection.ConnectionConfig{Type: "unknown"}, protection: "unknown", ddl: "unknown"},
		{name: "empty type", config: connection.ConnectionConfig{}, protection: "", ddl: ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := resolveConnectionProtectionDBType(test.config); got != test.protection {
				t.Errorf("protection dialect = %q, want %q", got, test.protection)
			}
			if got := resolveDDLDBType(test.config); got != test.ddl {
				t.Errorf("DDL dialect = %q, want %q", got, test.ddl)
			}
		})
	}
}

func TestPluginDataSourcePolicyBuiltinProtectionUnchanged(t *testing.T) {
	t.Parallel()
	all := connection.ConnectionProtectionConfig{
		RestrictDataEdit: true, RestrictStructureEdit: true,
		RestrictScriptExecution: true, RestrictDataImport: true,
	}
	partial := connection.ConnectionProtectionConfig{RestrictDataEdit: true}
	tests := []struct {
		name    string
		config  connection.ConnectionConfig
		want    connection.ConnectionProtectionConfig
		query   string
		blocked bool
	}{
		{name: "writable", config: connection.ConnectionConfig{Type: "mysql"}, query: "DELETE FROM users"},
		{name: "legacy readonly", config: connection.ConnectionConfig{Type: "postgres", ReadOnly: true}, want: all, query: "DELETE FROM users", blocked: true},
		{name: "granular protection", config: connection.ConnectionConfig{Type: "mysql", Protection: partial}, want: partial, query: "DELETE FROM users"},
		{name: "granular overrides legacy", config: connection.ConnectionConfig{Type: "mysql", ReadOnly: true, Protection: partial}, want: partial, query: "DELETE FROM users"},
		{name: "builtin empty query", config: connection.ConnectionConfig{Type: "postgres", ReadOnly: true}, want: all},
		{name: "builtin explain plan", config: connection.ConnectionConfig{Type: "postgres", ReadOnly: true}, want: all, query: "EXPLAIN DELETE FROM users"},
		{name: "builtin executing explain", config: connection.ConnectionConfig{Type: "postgres", ReadOnly: true}, want: all, query: "EXPLAIN ANALYZE DELETE FROM users", blocked: true},
		{name: "unsupported protection", config: connection.ConnectionConfig{Type: "not-an-engine", ReadOnly: true, Protection: all}, query: "DELETE FROM users"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := resolveConnectionProtectionConfig(test.config); got != test.want {
				t.Fatalf("protection = %+v, want %+v", got, test.want)
			}
			err := ensureConnectionAllowsQueryWithText(test.config, test.query, pluginPolicyTestText)
			if (err != nil) != test.blocked {
				t.Fatalf("query error = %v, want blocked=%v", err, test.blocked)
			}
		})
	}
}

func TestValidatePluginReadOnlyQuery(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		query   string
		allowed bool
	}{
		{name: "select", query: "SELECT * FROM users", allowed: true},
		{name: "readonly CTE", query: "WITH found AS (SELECT id FROM users) SELECT * FROM found", allowed: true},
		{name: "multiple reads", query: "SELECT 1; SELECT 2;", allowed: true},
		{name: "commented read", query: "/* DELETE FROM users */ SELECT 1; -- UPDATE users\n", allowed: true},
		{name: "quoted separator", query: "SELECT '; DELETE FROM users' AS message", allowed: true},
		{name: "explain read", query: "EXPLAIN SELECT * FROM users", allowed: true},
		{name: "empty"},
		{name: "whitespace", query: " \n\t\r"},
		{name: "separators", query: "; ; ;"},
		{name: "line comment", query: "-- SELECT 1"},
		{name: "block comment", query: "/* SELECT 1 */"},
		{name: "commented separators", query: "; /* SELECT 1 */; -- SELECT 2\n;"},
		{name: "unknown", query: "UNKNOWN users"},
		{name: "unresolved CTE", query: "WITH unfinished"},
		{name: "other engine command", query: "CONSUME FROM users"},
		{name: "delete", query: "DELETE FROM users"},
		{name: "update", query: "UPDATE users SET active = false"},
		{name: "insert", query: "INSERT INTO users (id) VALUES (1)"},
		{name: "drop", query: "DROP TABLE users"},
		{name: "call", query: "CALL mutate_users()"},
		{name: "transaction", query: "BEGIN; SELECT 1; COMMIT"},
		{name: "mutating CTE", query: "WITH removed AS (DELETE FROM users RETURNING id) SELECT * FROM removed"},
		{name: "CTE writes outside", query: "WITH found AS (SELECT id FROM users) DELETE FROM users WHERE id IN (SELECT id FROM found)"},
		{name: "select into", query: "SELECT * INTO archived_users FROM users"},
		{name: "select outfile", query: "SELECT id FROM users INTO OUTFILE '/tmp/plugin-policy-test'"},
		{name: "explain delete", query: "EXPLAIN DELETE FROM users"},
		{name: "explain replace", query: "EXPLAIN REPLACE INTO users (id) VALUES (1)"},
		{name: "explain call", query: "EXPLAIN CALL mutate_users()"},
		{name: "explain unknown", query: "EXPLAIN UNKNOWN users"},
		{name: "empty explain", query: "EXPLAIN"},
		{name: "executing explain mutation", query: "EXPLAIN ANALYZE DELETE FROM users"},
		{name: "explain select into", query: "EXPLAIN SELECT * INTO archived_users FROM users"},
		{name: "read then write", query: "SELECT 1; DELETE FROM users"},
		{name: "read then unknown", query: "SELECT 1; UNKNOWN users"},
		{name: "read then uncommented write", query: "SELECT 1; /* reason */ UPDATE users SET active = false"},
		{name: "embedded write", query: "SELECT id FROM users ORDER BY id DESC\nDELETE FROM users"},
		{name: "scheduler side effect", query: "SELECT cron.schedule('job', '* * * * *', 'SELECT 1')"},
	}
	for _, dialect := range []string{"mysql", "postgres", "sqlite"} {
		t.Run(dialect, func(t *testing.T) {
			t.Parallel()
			config := connection.ConnectionConfig{Type: "plugin:example.reader:source:" + dialect}
			for _, test := range tests {
				t.Run(test.name, func(t *testing.T) {
					for name, validate := range map[string]func() error{
						"adapter callback": func() error { return validatePluginReadOnlyQuery(config.Type, test.query, pluginPolicyTestText) },
						"connection guard": func() error { return ensureConnectionAllowsQueryWithText(config, test.query, pluginPolicyTestText) },
					} {
						err := validate()
						if (err == nil) != test.allowed {
							t.Errorf("%s error = %v, want allowed=%v", name, err, test.allowed)
						}
						if err != nil && err.Error() != "localized:query_editor.message.connection_readonly_blocked" {
							t.Errorf("%s returned unexpected blocked message: %v", name, err)
						}
					}
				})
			}
		})
	}
}

func TestValidatePluginReadOnlyQueryDialectSyntax(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		dialect string
		query   string
		allowed bool
	}{
		{name: "postgres dollar quote", dialect: "postgres", query: "SELECT $body$; DELETE FROM users$body$", allowed: true},
		{name: "postgres quote then mutation", dialect: "postgres", query: "SELECT $body$;$body$; DELETE FROM users"},
		{name: "postgres array then mutation", dialect: "postgres", query: "SELECT ARRAY[[1,2],[3,4]]; DELETE FROM users"},
		{name: "postgres explain options", dialect: "postgres", query: "EXPLAIN (FORMAT JSON) SELECT * FROM users", allowed: true},
		{name: "postgres executing read", dialect: "postgres", query: "EXPLAIN (ANALYZE true, BUFFERS true) SELECT * FROM users", allowed: true},
		{name: "postgres option mutation", dialect: "postgres", query: "EXPLAIN (ANALYZE false) DELETE FROM users"},
		{name: "postgres explain CTE mutation", dialect: "postgres", query: "EXPLAIN WITH removed AS (DELETE FROM users RETURNING id) SELECT * FROM removed"},
		{name: "postgres malformed explain", dialect: "postgres", query: "EXPLAIN (FORMAT JSON SELECT 1"},
		{name: "sqlite bracket identifier", dialect: "sqlite", query: "SELECT [a;b] FROM users", allowed: true},
		{name: "sqlite bracket then mutation", dialect: "sqlite", query: "SELECT [a;b] FROM users; DELETE FROM users"},
		{name: "sqlite metadata pragma", dialect: "sqlite", query: "PRAGMA table_info('users')", allowed: true},
		{name: "sqlite mutating pragma", dialect: "sqlite", query: "PRAGMA journal_mode=WAL"},
		{name: "sqlite action pragma", dialect: "sqlite", query: "PRAGMA optimize"},
		{name: "sqlite query plan", dialect: "sqlite", query: "EXPLAIN QUERY PLAN SELECT * FROM users", allowed: true},
		{name: "sqlite mutating query plan", dialect: "sqlite", query: "EXPLAIN QUERY PLAN DELETE FROM users"},
		{name: "sqlite unknown query plan", dialect: "sqlite", query: "EXPLAIN QUERY PLAN UNKNOWN users"},
		{name: "mysql quoted identifier", dialect: "mysql", query: "SELECT `a;b` FROM users", allowed: true},
		{name: "mysql hash comment", dialect: "mysql", query: "SELECT 1; # DELETE FROM users\nSELECT 2", allowed: true},
		{name: "mysql comment only", dialect: "mysql", query: "# SELECT 1"},
		{name: "mysql executable comment", dialect: "mysql", query: "SELECT 1; /*!50000 DELETE FROM users */"},
		{name: "mysql executable comment only", dialect: "mysql", query: "/*!50000 SELECT 1 */"},
		{name: "mysql show create", dialect: "mysql", query: "SHOW CREATE TABLE users", allowed: true},
		{name: "mysql explain format", dialect: "mysql", query: "EXPLAIN FORMAT=JSON SELECT * FROM users", allowed: true},
		{name: "mysql mutating explain format", dialect: "mysql", query: "EXPLAIN FORMAT=JSON DELETE FROM users"},
		{name: "mysql unknown explain format", dialect: "mysql", query: "EXPLAIN FORMAT=UNKNOWN SELECT 1"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := validatePluginReadOnlyQuery("plugin:example.reader:source:"+test.dialect, test.query, pluginPolicyTestText)
			if (err == nil) != test.allowed {
				t.Fatalf("query error = %v, want allowed=%v", err, test.allowed)
			}
		})
	}
}

func TestValidatePluginReadOnlyQueryInvalidIdentity(t *testing.T) {
	t.Parallel()
	for _, typeName := range []string{
		"", "mysql", "plugin:", "plugin:example.reader::mysql",
		"plugin:example.reader:source:postgresql", "PLUGIN:example.reader:source:mysql",
		"plugin:Example.reader:source:mysql", "plugin:example.reader:source:MYSQL",
		" plugin:example.reader:source:mysql ",
	} {
		t.Run(typeName, func(t *testing.T) {
			t.Parallel()
			if err := validatePluginReadOnlyQuery(typeName, "SELECT 1", pluginPolicyTestText); err == nil {
				t.Fatal("invalid identity was allowed to execute SQL")
			}
			if isPluginDataSourceType(typeName) {
				config := connection.ConnectionConfig{Type: typeName}
				if err := ensureConnectionAllowsQueryWithText(config, "SELECT 1", pluginPolicyTestText); err == nil {
					t.Fatal("connection guard normalized an invalid plugin identity")
				}
			}
		})
	}
}

func TestValidatePluginReadOnlyQueryUsesExistingLocalization(t *testing.T) {
	t.Parallel()
	for _, test := range []struct{ typeName, query string }{
		{typeName: "plugin:", query: "SELECT 1"},
		{typeName: "plugin:example.reader:source:mysql", query: "/* empty */"},
		{typeName: "plugin:example.reader:source:mysql", query: "DELETE FROM users"},
	} {
		t.Run(test.typeName+test.query, func(t *testing.T) {
			t.Parallel()
			calls := 0
			text := func(key string, params map[string]any) string {
				calls++
				if key != "query_editor.message.connection_readonly_blocked" || params != nil {
					t.Fatalf("unexpected translation request: key=%q params=%v", key, params)
				}
				return "localized blocked message"
			}
			if err := validatePluginReadOnlyQuery(test.typeName, test.query, text); err == nil || err.Error() != "localized blocked message" {
				t.Fatalf("localized error = %v", err)
			}
			if calls != 1 {
				t.Fatalf("translation calls = %d, want 1", calls)
			}
			if err := validatePluginReadOnlyQuery(test.typeName, test.query, nil); err == nil {
				t.Fatal("nil translator bypassed protection")
			}
		})
	}
}

func TestPluginDataSourcePolicySelectedDatabase(t *testing.T) {
	t.Parallel()
	for _, typeName := range []string{
		"plugin:example.reader:source:mysql", "plugin:example.reader:source:postgres",
		"plugin:example.reader:source:sqlite", "plugin:", " PLUGIN:example.reader:source:MYSQL ",
	} {
		t.Run(typeName, func(t *testing.T) {
			t.Parallel()
			for _, test := range []struct{ selected, want string }{
				{selected: " selected.database ", want: "selected.database"},
				{selected: "", want: "saved.database"},
				{selected: " \t", want: "saved.database"},
			} {
				config := connection.ConnectionConfig{
					Type: typeName, Database: "saved.database", ConnectionParams: "application_name=policy-test",
					MetadataScope: &connection.MetadataDiscoveryScope{},
				}
				for name, normalize := range map[string]func(connection.ConnectionConfig, string) connection.ConnectionConfig{
					"query": normalizeRunConfig, "metadata": normalizeMetadataRunConfig,
				} {
					got := normalize(config, test.selected)
					if got.Database != test.want || got.Type != typeName || got.ConnectionParams != config.ConnectionParams {
						t.Errorf("%s config: database=%q type=%q params=%q", name, got.Database, got.Type, got.ConnectionParams)
					}
					if got.MetadataScope != nil {
						t.Errorf("%s config retained a request-only metadata scope", name)
					}
				}
				if config.Database != "saved.database" || config.MetadataScope == nil {
					t.Fatal("normalization changed the saved config")
				}
			}
		})
	}
}

func TestPluginDataSourcePolicyBuiltinDatabaseSelectionUnchanged(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name           string
		config         connection.ConnectionConfig
		selected       string
		wantDatabase   string
		wantSchema     string
		wantRedisDB    int
		wantDBOverride string
	}{
		{name: "mysql", config: connection.ConnectionConfig{Type: "mysql", Database: "saved"}, selected: " selected ", wantDatabase: "selected"},
		{name: "postgres", config: connection.ConnectionConfig{Type: "postgres", Database: "saved"}, selected: "selected", wantDatabase: "selected"},
		{name: "sqlite file", config: connection.ConnectionConfig{Type: "sqlite", Database: "saved.db"}, selected: "main", wantDatabase: "saved.db"},
		{name: "oracle service", config: connection.ConnectionConfig{Type: "oracle", Database: "service"}, selected: "OWNER", wantDatabase: "service", wantSchema: "OWNER"},
		{name: "oceanbase oracle", config: connection.ConnectionConfig{Type: "oceanbase", Database: "service", OceanBaseProtocol: "oracle"}, selected: "OWNER", wantDatabase: "service"},
		{name: "oceanbase mysql", config: connection.ConnectionConfig{Type: "oceanbase", Database: "saved"}, selected: "selected", wantDatabase: "selected"},
		{name: "redis", config: connection.ConnectionConfig{Type: "redis", Database: "0"}, selected: "18", wantDatabase: "18", wantRedisDB: 18},
		{name: "mqtt topic", config: connection.ConnectionConfig{Type: "mqtt", Database: "topic"}, selected: "topics", wantDatabase: "topic"},
		{name: "rocketmq topic", config: connection.ConnectionConfig{Type: "rocketmq", Database: "topic"}, selected: "topics", wantDatabase: "topic"},
		{name: "kafka topic", config: connection.ConnectionConfig{Type: "kafka", Database: "topic"}, selected: "topics", wantDatabase: "topic"},
		{name: "custom driver", config: connection.ConnectionConfig{Type: "custom", Driver: "postgres-driver", Database: "saved"}, selected: "selected", wantDatabase: "saved"},
		{name: "custom clickhouse", config: connection.ConnectionConfig{Type: "custom", Driver: "clickhouse", Database: "saved"}, selected: "selected", wantDatabase: "saved", wantDBOverride: "selected"},
		{name: "no selection", config: connection.ConnectionConfig{Type: "mysql", Database: "saved"}, wantDatabase: "saved"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			for name, normalize := range map[string]func(connection.ConnectionConfig, string) connection.ConnectionConfig{
				"query": normalizeRunConfig, "metadata": normalizeMetadataRunConfig,
			} {
				got := normalize(test.config, test.selected)
				if got.Database != test.wantDatabase || got.RedisDB != test.wantRedisDB || got.RuntimeDatabaseOverride() != test.wantDBOverride {
					t.Errorf("%s selection: database=%q redis=%d override=%q", name, got.Database, got.RedisDB, got.RuntimeDatabaseOverride())
				}
				wantSchema := test.wantSchema
				if name == "metadata" {
					wantSchema = ""
				}
				if got.RuntimeOracleCurrentSchema() != wantSchema {
					t.Errorf("%s schema = %q, want %q", name, got.RuntimeOracleCurrentSchema(), wantSchema)
				}
			}
		})
	}
}

func pluginPolicyTestText(key string, _ map[string]any) string {
	return "localized:" + key
}

func TestPluginWritableConnectionHonorsExplicitProtection(t *testing.T) {
	t.Parallel()
	partial := connection.ConnectionProtectionConfig{RestrictDataEdit: true}
	full := connection.ConnectionProtectionConfig{
		RestrictDataEdit: true, RestrictStructureEdit: true,
		RestrictScriptExecution: true, RestrictDataImport: true,
	}
	tests := []struct {
		name   string
		config connection.ConnectionConfig
		want   connection.ConnectionProtectionConfig
	}{
		{name: "writable default", config: connection.ConnectionConfig{Type: "plugin:example.writer:source:sqlite", PluginWritable: true}},
		{name: "writable partial", config: connection.ConnectionConfig{Type: "plugin:example.writer:source:sqlite", PluginWritable: true, Protection: partial}, want: partial},
		{name: "writable still read-only", config: connection.ConnectionConfig{Type: "plugin:example.writer:source:sqlite", PluginWritable: true, ReadOnly: true}, want: full},
		{name: "legacy missing hint", config: connection.ConnectionConfig{Type: "plugin:example.writer:source:sqlite"}, want: full},
		{name: "forged read-only config", config: connection.ConnectionConfig{Type: "plugin:example.writer:source:sqlite", ReadOnly: false}, want: full},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := resolveConnectionProtectionConfig(test.config); got != test.want {
				t.Fatalf("protection = %+v, want %+v", got, test.want)
			}
			if test.want != (connection.ConnectionProtectionConfig{}) {
				return
			}
			if err := ensureConnectionAllowsQueryWithText(test.config, "DELETE FROM demo", pluginPolicyTestText); err != nil {
				t.Fatalf("writable query blocked: %v", err)
			}
		})
	}
}
