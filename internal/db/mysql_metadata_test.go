package db

import (
	"errors"
	"reflect"
	"testing"
)

func TestCollectMySQLDatabaseNames_FallsBackToCurrentDatabase(t *testing.T) {
	t.Parallel()

	got, err := collectMySQLDatabaseNames(func(query string) ([]map[string]interface{}, []string, error) {
		switch query {
		case mysqlDatabaseQueries[0]:
			return nil, nil, errors.New("Error 1227 (42000): Access denied; you need (at least one of) the SHOW DATABASES privilege(s) for this operation")
		case mysqlDatabaseQueries[1]:
			return []map[string]interface{}{
				{"database_name": "biz_app"},
			}, []string{"database_name"}, nil
		default:
			return nil, nil, errors.New("unexpected query")
		}
	})
	if err != nil {
		t.Fatalf("collectMySQLDatabaseNames 返回错误: %v", err)
	}

	want := []string{"biz_app"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected database names, got=%v want=%v", got, want)
	}
}

func TestCollectMySQLDatabaseNames_AcceptsMyCATStyleSchemaColumn(t *testing.T) {
	t.Parallel()

	got, err := collectMySQLDatabaseNames(func(query string) ([]map[string]interface{}, []string, error) {
		switch query {
		case mysqlDatabaseQueries[0]:
			return []map[string]interface{}{
				{"SCHEMA": "analytics"},
			}, []string{"SCHEMA"}, nil
		case mysqlDatabaseQueries[1]:
			return []map[string]interface{}{
				{"Database": "should_not_be_used"},
			}, []string{"Database"}, nil
		default:
			return nil, nil, errors.New("unexpected query")
		}
	})
	if err != nil {
		t.Fatalf("collectMySQLDatabaseNames 返回错误: %v", err)
	}

	want := []string{"analytics"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected database names, got=%v want=%v", got, want)
	}
}

func TestCollectMySQLDatabaseNames_PrefersShowDatabasesWhenAvailable(t *testing.T) {
	t.Parallel()

	got, err := collectMySQLDatabaseNames(func(query string) ([]map[string]interface{}, []string, error) {
		switch query {
		case mysqlDatabaseQueries[0]:
			return []map[string]interface{}{
				{"Database": "analytics"},
				{"database": "audit"},
			}, nil, nil
		case mysqlDatabaseQueries[1]:
			return []map[string]interface{}{
				{"Database": "should_not_be_used"},
			}, nil, nil
		default:
			return nil, nil, errors.New("unexpected query")
		}
	})
	if err != nil {
		t.Fatalf("collectMySQLDatabaseNames 返回错误: %v", err)
	}

	want := []string{"analytics", "audit"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected database names, got=%v want=%v", got, want)
	}
}

func TestCollectMySQLDatabaseNames_ReturnsOriginalErrorWhenNoDatabaseResolved(t *testing.T) {
	t.Parallel()

	expectErr := errors.New("show databases denied")
	got, err := collectMySQLDatabaseNames(func(query string) ([]map[string]interface{}, []string, error) {
		switch query {
		case mysqlDatabaseQueries[0]:
			return nil, nil, expectErr
		case mysqlDatabaseQueries[1]:
			return []map[string]interface{}{
				{"Database": nil},
			}, nil, nil
		case mysqlDatabaseQueries[2]:
			return []map[string]interface{}{
				{"database_name": nil},
			}, nil, nil
		default:
			return nil, nil, errors.New("unexpected query")
		}
	})
	if err == nil {
		t.Fatalf("期望返回错误，实际 got=%v", got)
	}
	if !errors.Is(err, expectErr) {
		t.Fatalf("错误不符合预期: %v", err)
	}
}

func TestCollectMySQLDatabaseNames_FallsBackToInformationSchemaSchemata(t *testing.T) {
	t.Parallel()

	got, err := collectMySQLDatabaseNames(func(query string) ([]map[string]interface{}, []string, error) {
		switch query {
		case mysqlDatabaseQueries[0]:
			return nil, nil, errors.New("show databases denied")
		case mysqlDatabaseQueries[1]:
			return []map[string]interface{}{
				{"Database": nil},
			}, nil, nil
		case mysqlDatabaseQueries[2]:
			return []map[string]interface{}{
				{"SCHEMA_NAME": "leite-finance"},
				{"database_name": "analytics"},
			}, []string{"SCHEMA_NAME", "database_name"}, nil
		default:
			return nil, nil, errors.New("unexpected query")
		}
	})
	if err != nil {
		t.Fatalf("collectMySQLDatabaseNames 返回错误: %v", err)
	}

	want := []string{"leite-finance", "analytics"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected database names, got=%v want=%v", got, want)
	}
}

func TestBuildMySQLShowCreateTableQueryNormalizesQuotedIdentifiers(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		dbName    string
		tableName string
		want      string
	}{
		{
			name:      "plain db and quoted table",
			dbName:    "app",
			tableName: `"activate_record"`,
			want:      "SHOW CREATE TABLE `app`.`activate_record`",
		},
		{
			name:      "escaped quoted qualified table overrides db",
			dbName:    "ignored",
			tableName: `\"crm\".\"activate_record\"`,
			want:      "SHOW CREATE TABLE `crm`.`activate_record`",
		},
		{
			name:      "backtick escaping",
			dbName:    "app`prod",
			tableName: "`audit``log`",
			want:      "SHOW CREATE TABLE `app``prod`.`audit``log`",
		},
		{
			name:      "quoted table containing dot is not split",
			dbName:    "app",
			tableName: `"activate.record"`,
			want:      "SHOW CREATE TABLE `app`.`activate.record`",
		},
		{
			name:      "mixed quote artifact from UI row value",
			dbName:    "app",
			tableName: `'activate_record"`,
			want:      "SHOW CREATE TABLE `app`.`activate_record`",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := buildMySQLShowCreateTableQuery(tt.dbName, tt.tableName); got != tt.want {
				t.Fatalf("buildMySQLShowCreateTableQuery(%q,%q)=%q,want=%q", tt.dbName, tt.tableName, got, tt.want)
			}
		})
	}
}

func TestBuildMySQLShowFullColumnsQueryEscapesIdentifiers(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		dbName    string
		tableName string
		want      string
	}{
		{
			name:      "plain qualified table",
			dbName:    "app",
			tableName: "users",
			want:      "SHOW FULL COLUMNS FROM `app`.`users`",
		},
		{
			name:      "backticks cannot terminate identifiers",
			dbName:    "app`prod",
			tableName: "audit`log",
			want:      "SHOW FULL COLUMNS FROM `app``prod`.`audit``log`",
		},
		{
			name:      "quoted qualified table overrides database",
			dbName:    "ignored",
			tableName: `"sales.region"."daily.order"`,
			want:      "SHOW FULL COLUMNS FROM `sales.region`.`daily.order`",
		},
		{
			name:      "quoted dotted table remains one identifier",
			dbName:    "app",
			tableName: "`audit.logs`",
			want:      "SHOW FULL COLUMNS FROM `app`.`audit.logs`",
		},
		{
			name:      "table without database",
			tableName: "standalone",
			want:      "SHOW FULL COLUMNS FROM `standalone`",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := buildMySQLShowFullColumnsQuery(tt.dbName, tt.tableName); got != tt.want {
				t.Fatalf("buildMySQLShowFullColumnsQuery(%q,%q)=%q,want=%q", tt.dbName, tt.tableName, got, tt.want)
			}
		})
	}
}
