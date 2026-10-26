//go:build gonavi_full_drivers || gonavi_kingbase_driver

package db

import (
	"reflect"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/shared/i18n"
)

func TestResolveKingbaseConnectDatabases_ExplicitDatabase(t *testing.T) {
	cfg := connection.ConnectionConfig{
		Type:     "kingbase",
		Database: "analytics",
		User:     "gonavi_kingbase",
	}

	got := resolveKingbaseConnectDatabases(cfg)
	want := []string{"analytics"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected databases, got=%v want=%v", got, want)
	}
}

func TestResolveKingbaseConnectDatabases_UsesKingbaseDefaultsWithoutUser(t *testing.T) {
	cfg := connection.ConnectionConfig{
		Type: "kingbase",
		User: "gonavi_kingbase",
	}

	got := resolveKingbaseConnectDatabases(cfg)
	want := []string{"test", "template1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected databases, got=%v want=%v", got, want)
	}
	for _, database := range got {
		if strings.EqualFold(database, cfg.User) {
			t.Fatalf("database candidates must not include the connection user %q: %v", cfg.User, got)
		}
	}
}

func TestResolveKingbaseConnectDatabases_HonorsConnectionParamDatabase(t *testing.T) {
	cfg := connection.ConnectionConfig{
		Type:             "kingbase",
		User:             "gonavi_kingbase",
		ConnectionParams: "application_name=GoNavi&DBNAME=analytics",
	}

	got := resolveKingbaseConnectDatabases(cfg)
	want := []string{"analytics"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected databases, got=%v want=%v", got, want)
	}
}

func TestResolveKingbaseConnectDatabases_HonorsDatabaseAlias(t *testing.T) {
	cfg := connection.ConnectionConfig{
		Type:             "kingbase",
		User:             "gonavi_kingbase",
		ConnectionParams: "application_name=GoNavi&database=analytics",
	}

	got := resolveKingbaseConnectDatabases(cfg)
	want := []string{"analytics"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected databases, got=%v want=%v", got, want)
	}
}

func TestResolveKingbaseConnectDatabases_UsesURIPath(t *testing.T) {
	cfg := connection.ConnectionConfig{
		Type: "kingbase",
		URI:  "kingbase://gonavi_kingbase:pass@127.0.0.1:54321/analytics",
	}

	got := resolveKingbaseConnectDatabases(cfg)
	want := []string{"analytics"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected databases, got=%v want=%v", got, want)
	}
}

func TestResolveKingbaseConnectDatabases_ExplicitDatabaseOverridesURIPath(t *testing.T) {
	cfg := connection.ConnectionConfig{
		Type:     "kingbase",
		URI:      "kingbase://gonavi_kingbase:pass@127.0.0.1:54321/from-uri",
		Database: "from-config",
	}

	got := resolveKingbaseConnectDatabases(cfg)
	want := []string{"from-config"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected databases, got=%v want=%v", got, want)
	}
}

func TestResolveKingbaseConnectDatabases_QueryOverridesURIPath(t *testing.T) {
	cfg := connection.ConnectionConfig{
		Type: "kingbase",
		URI:  "kingbase://gonavi_kingbase:pass@127.0.0.1:54321/from-uri?dbname=from-query",
	}

	got := resolveKingbaseConnectDatabases(cfg)
	want := []string{"from-query"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected databases, got=%v want=%v", got, want)
	}
}

func TestResolveKingbaseConnectDatabases_ConnectionParamsOverrideURIQuery(t *testing.T) {
	cfg := connection.ConnectionConfig{
		Type:             "kingbase",
		URI:              "kingbase://gonavi_kingbase:pass@127.0.0.1:54321/from-uri?dbname=from-query",
		ConnectionParams: "database=from-params",
	}

	got := resolveKingbaseConnectDatabases(cfg)
	want := []string{"from-params"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected databases, got=%v want=%v", got, want)
	}
}

func TestResolveKingbaseConnectDatabases_SupportsPostgresURIPath(t *testing.T) {
	cfg := connection.ConnectionConfig{
		Type: "kingbase",
		URI:  "postgresql://gonavi_kingbase:pass@127.0.0.1:54321/analytics",
	}

	got := resolveKingbaseConnectDatabases(cfg)
	want := []string{"analytics"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected databases, got=%v want=%v", got, want)
	}
}

func TestKingbaseDSN_UsesDefaultDatabaseWhenDatabaseIsEmpty(t *testing.T) {
	cfg := connection.ConnectionConfig{
		Type:     "kingbase",
		Host:     "127.0.0.1",
		Port:     54321,
		User:     "gonavi_kingbase",
		Password: "pass",
	}

	dsn := (&KingbaseDB{}).getDSN(cfg)
	if strings.Contains(dsn, "dbname=''") {
		t.Fatalf("empty database must not be sent to Kingbase: %s", dsn)
	}
	if !strings.Contains(dsn, "dbname=test") {
		t.Fatalf("empty database should use the Kingbase maintenance database: %s", dsn)
	}
}

func TestKingbaseDSN_UsesURIPathDatabaseWhenDatabaseIsEmpty(t *testing.T) {
	cfg := connection.ConnectionConfig{
		Type:     "kingbase",
		Host:     "127.0.0.1",
		Port:     54321,
		User:     "gonavi_kingbase",
		Password: "pass",
		URI:      "kingbase://gonavi_kingbase:pass@127.0.0.1:54321/analytics",
	}

	dsn := (&KingbaseDB{}).getDSN(cfg)
	if !strings.Contains(dsn, "dbname=analytics") {
		t.Fatalf("URI path database should be used when config database is empty: %s", dsn)
	}
}

func TestResolveKingbaseExplicitDatabase_ConnectionParamOverridesDatabase(t *testing.T) {
	cfg := connection.ConnectionConfig{
		Type:             "kingbase",
		Database:         "from-config",
		User:             "gonavi_kingbase",
		ConnectionParams: "dbname=from-params",
	}
	if got := resolveKingbaseExplicitDatabase(cfg); got != "from-params" {
		t.Fatalf("connection params must win, got %q", got)
	}

	cfg.ConnectionParams = ""
	if got := resolveKingbaseExplicitDatabase(cfg); got != "from-config" {
		t.Fatalf("config database expected, got %q", got)
	}

	cfg.Database = ""
	if got := resolveKingbaseExplicitDatabase(cfg); got != "" {
		t.Fatalf("empty config expected, got %q", got)
	}
}

func TestKingbaseConnectFailureError_MaintenanceHint(t *testing.T) {
	failures := []string{"SSL 数据库=test 验证失败: kb: database locale is incompatible with operating system"}

	SetBackendLanguage(i18n.LanguageZhCN)
	errZh := kingbaseConnectFailureError(failures, true)
	if !strings.Contains(errZh.Error(), "连接建立后验证失败：") {
		t.Fatalf("missing failure prefix: %q", errZh.Error())
	}
	if !strings.Contains(errZh.Error(), "维护库") || !strings.Contains(errZh.Error(), "数据库名") {
		t.Fatalf("missing maintenance-database hint: %q", errZh.Error())
	}

	SetBackendLanguage(i18n.LanguageEnUS)
	defer SetBackendLanguage(i18n.LanguageZhCN)
	if err := kingbaseConnectFailureError(failures, true); !strings.Contains(err.Error(), "maintenance databases") {
		t.Fatalf("missing English maintenance hint: %q", err.Error())
	}

	if err := kingbaseConnectFailureError(failures, false); strings.Contains(err.Error(), "维护库") || strings.Contains(err.Error(), "maintenance databases") {
		t.Fatalf("hint must be absent when the database was explicit: %q", err.Error())
	}
}
