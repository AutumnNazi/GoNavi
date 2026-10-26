//go:build gonavi_full_drivers || gonavi_hive_driver

package db

import (
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestHiveLiveSmoke(t *testing.T) {
	configs := hiveLiveConfigs(t)
	for _, tc := range configs {
		t.Run(tc.name, func(t *testing.T) {
			client := &HiveDB{}
			if err := client.Connect(tc.config); err != nil {
				t.Fatalf("connect: %v", err)
			}
			defer client.Close()

			variant, version := client.DriverVariantInfo()
			t.Logf("Hive server %s resolved to variant %s", version, variant)
			if variant == "" || version == "" {
				t.Fatal("variant and version must be resolved from SELECT version()")
			}

			if err := client.Ping(); err != nil {
				t.Fatalf("ping: %v", err)
			}

			databases, err := client.GetDatabases()
			if err != nil || !slices.Contains(databases, "default") {
				t.Fatalf("databases %v: %v", databases, err)
			}

			targetDB := tc.config.Database
			if slices.Contains(databases, "dw") {
				targetDB = "dw"
			}
			tables, err := client.GetTables(targetDB)
			if err != nil {
				t.Fatalf("GetTables(%s): %v", targetDB, err)
			}
			t.Logf("tables in %s: %v", targetDB, tables)

			if slices.Contains(tables, "ods_orders") {
				cols, err := client.GetColumns(targetDB, "ods_orders")
				if err != nil || len(cols) == 0 {
					t.Fatalf("GetColumns(ods_orders) %#v: %v", cols, err)
				}
				var foundPartition bool
				for _, col := range cols {
					if col.Name == "dt" && col.Extra == "PARTITION KEY" {
						foundPartition = true
					}
				}
				if !foundPartition {
					t.Fatalf("expected dt column to have PARTITION KEY extra, got %#v", cols)
				}

				ddl, err := client.GetCreateStatement(targetDB, "ods_orders")
				if err != nil || !strings.Contains(strings.ToUpper(ddl), "CREATE") {
					t.Fatalf("GetCreateStatement(ods_orders) %q: %v", ddl, err)
				}

				rows, colNames, err := client.Query("SELECT order_id, user_id, qty FROM `" + targetDB + "`.`ods_orders` LIMIT 5 OFFSET 0")
				if err != nil {
					t.Fatalf("Query ods_orders: %v", err)
				}
				t.Logf("queried %d rows from ods_orders, columns=%v", len(rows), colNames)
				if slices.Contains(colNames, "ods_orders.order_id") {
					t.Fatalf("expected unqualified column names, got %v", colNames)
				}

				allCols, err := client.GetAllColumns(targetDB)
				if err != nil || len(allCols) == 0 {
					t.Fatalf("GetAllColumns(%s) %v: %v", targetDB, allCols, err)
				}
				t.Logf("GetAllColumns(%s) returned %d columns", targetDB, len(allCols))
			}

			_, _ = client.Exec("DROP VIEW IF EXISTS `default`.`gonavi_hive_smoke_v`")
			_, _ = client.Exec("DROP TABLE IF EXISTS `default`.`gonavi_hive_smoke_t`")
			mustExec(t, client, "CREATE TABLE `default`.`gonavi_hive_smoke_t` (`id` INT COMMENT '主键', `name` STRING COMMENT '名称')")
			defer func() { _, _ = client.Exec("DROP TABLE IF EXISTS `default`.`gonavi_hive_smoke_t`") }()

			if err := client.ApplyChanges("`default`.`gonavi_hive_smoke_t`", connection.ChangeSet{
				Inserts: []map[string]interface{}{
					{"id": 1, "name": "alice"},
					{"id": 2, "name": "bob"},
				},
			}); err != nil {
				t.Fatalf("ApplyChanges insert: %v", err)
			}
			if err := client.ApplyChanges("`default`.`gonavi_hive_smoke_t`", connection.ChangeSet{
				Deletes: []map[string]interface{}{{"id": 1}},
			}); err == nil {
				t.Fatal("expected single-row delete in ApplyChanges to be rejected for Hive")
			}

			mustExec(t, client, "CREATE VIEW `default`.`gonavi_hive_smoke_v` AS SELECT `id`, `name` FROM `default`.`gonavi_hive_smoke_t` WHERE `id` >= 1")
			defer func() { _, _ = client.Exec("DROP VIEW IF EXISTS `default`.`gonavi_hive_smoke_v`") }()

			defaultTables, err := client.GetTables("default")
			if err != nil || !slices.Contains(defaultTables, "gonavi_hive_smoke_t") || slices.Contains(defaultTables, "gonavi_hive_smoke_v") {
				t.Fatalf("default tables (must include table and exclude view) %v: %v", defaultTables, err)
			}

			viewDDL, err := client.GetCreateStatement("default", "gonavi_hive_smoke_v")
			if err != nil || !strings.Contains(strings.ToUpper(viewDDL), "CREATE VIEW") {
				t.Fatalf("GetCreateStatement(view) %q: %v", viewDDL, err)
			}

			paged, _, err := client.QueryContextWithArgs(t.Context(), "SELECT `name` FROM `default`.`gonavi_hive_smoke_t` WHERE `id` >= ? ORDER BY `id` LIMIT 1 OFFSET 1", []any{1})
			if err != nil || len(paged) != 1 || paged[0]["name"] != "bob" {
				t.Fatalf("paged query with args %v: %v", paged, err)
			}
		})
	}
}

type namedHiveLiveConfig struct {
	name   string
	config connection.ConnectionConfig
}

func hiveLiveConfigs(t *testing.T) []namedHiveLiveConfig {
	t.Helper()
	var list []namedHiveLiveConfig
	if rawAddrs := strings.TrimSpace(os.Getenv("GONAVI_HIVE_TEST_ADDRS")); rawAddrs != "" {
		for _, addr := range strings.Split(rawAddrs, ",") {
			cfg := liveConfig(t, "hive", addr, "hive", "default")
			cfg.Timeout = 30
			list = append(list, namedHiveLiveConfig{name: addr, config: cfg})
		}
	}
	if sshSpec := strings.TrimSpace(os.Getenv("GONAVI_HIVE_TEST_SSH")); sshSpec != "" {
		// 格式：user@host:port（例如 lskam@frp-fun.com:49692）
		user := "root"
		hostPort := sshSpec
		if at := strings.Index(sshSpec, "@"); at > 0 {
			user = sshSpec[:at]
			hostPort = sshSpec[at+1:]
		}
		sshHost, sshPortText, ok := strings.Cut(hostPort, ":")
		sshPort := 22
		if ok {
			if p, err := strconv.Atoi(sshPortText); err == nil && p > 0 {
				sshPort = p
			}
		} else {
			sshHost = hostPort
		}
		home, _ := os.UserHomeDir()
		keyPath := os.Getenv("GONAVI_HIVE_TEST_SSH_KEY")
		if keyPath == "" && home != "" {
			keyPath = filepath.Join(home, ".ssh", "id_ed25519")
		}
		list = append(list, namedHiveLiveConfig{
			name: "ssh-" + sshSpec,
			config: connection.ConnectionConfig{
				Type:     "hive",
				Host:     "127.0.0.1",
				Port:     10000,
				User:     "hive",
				Database: "dw",
				Timeout:  30,
				UseSSH:   true,
				SSH: connection.SSHConfig{
					Host:    sshHost,
					Port:    sshPort,
					User:    user,
					KeyPath: keyPath,
				},
			},
		})
	}
	if len(list) == 0 {
		t.Skip("set GONAVI_HIVE_TEST_ADDRS=host:port or GONAVI_HIVE_TEST_SSH=user@host:port to run Hive live tests")
	}
	return list
}
