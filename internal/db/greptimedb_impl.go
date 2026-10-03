//go:build gonavi_full_drivers || gonavi_greptimedb_driver

package db

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
)

const (
	defaultGreptimeDBPort     = 4002
	defaultGreptimeDBDatabase = "public"
)

var greptimeDBVersionPattern = regexp.MustCompile(`(?i)greptimedb-v?(\d+(?:\.\d+)*)`)

// GreptimeDB 通过 MySQL 协议接入 GreptimeDB。库表与 DDL 沿用 MySQL 链路；列与索引改读
// information_schema（GreptimeDB 不接受库名限定的 SHOW COLUMNS），并标出 TAG / FIELD / TIME INDEX。
type GreptimeDB struct {
	MySQLDB
	driverVariantState
}

var (
	_ Database              = (*GreptimeDB)(nil)
	_ DriverVariantReporter = (*GreptimeDB)(nil)
)

func (g *GreptimeDB) bindMetadataContext(ctx context.Context) {
	BindMetadataContext(&g.MySQLDB, ctx)
}

func (g *GreptimeDB) clearMetadataContext() {
	ClearMetadataContext(&g.MySQLDB)
}

// Connect 复用 MySQL 连接链路（SSL、SSH、代理），默认端口 4002、库 public，并按 version() 识别档位。
func (g *GreptimeDB) Connect(config connection.ConnectionConfig) error {
	runConfig := rewriteURIScheme(config, "mysql", "greptimedb", "greptime")
	if runConfig.Port <= 0 {
		runConfig.Port = defaultGreptimeDBPort
	}
	if strings.TrimSpace(runConfig.Database) == "" {
		runConfig.Database = defaultGreptimeDBDatabase
	}
	if err := g.MySQLDB.Connect(runConfig); err != nil {
		return err
	}
	version := ""
	if rows, _, err := g.MySQLDB.Query("SELECT version() AS version"); err == nil {
		version = parseGreptimeDBVersion(FirstQueryRowValue(rows))
	} else {
		logger.Warnf("GreptimeDB 版本识别失败：%v", err)
	}
	if err := g.resolve("greptimedb", config, version); err != nil {
		_ = g.MySQLDB.Close()
		return err
	}
	return nil
}

// parseGreptimeDBVersion 从 "8.4.2-GreptimeDB-1.2.1"、"8.4.2-greptimedb-0.17.2" 里取 GreptimeDB 自身版本。
func parseGreptimeDBVersion(banner string) string {
	match := greptimeDBVersionPattern.FindStringSubmatch(banner)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func greptimeDBSchemaFilter(dbName string) string {
	schema := strings.TrimSpace(dbName)
	if schema == "" {
		schema = defaultGreptimeDBDatabase
	}
	return "table_schema = '" + strings.ReplaceAll(schema, "'", "''") + "'"
}

func greptimeDBTableFilter(dbName, tableName string) string {
	return greptimeDBSchemaFilter(dbName) + " AND table_name = '" + strings.ReplaceAll(strings.TrimSpace(tableName), "'", "''") + "'"
}

// GetColumns 读取 information_schema.columns：主键（tag）列 Key 为 PRI，Extra 标出语义类型与 TIME INDEX。
func (g *GreptimeDB) GetColumns(dbName, tableName string) ([]connection.ColumnDefinition, error) {
	rows, _, err := g.MySQLDB.Query(`SELECT column_name, data_type, is_nullable, column_key, column_default, column_comment, semantic_type
FROM information_schema.columns WHERE ` + greptimeDBTableFilter(dbName, tableName) + ` ORDER BY ordinal_position`)
	if err != nil {
		return nil, err
	}
	columns := make([]connection.ColumnDefinition, 0, len(rows))
	for _, row := range rows {
		column := connection.ColumnDefinition{
			Name:     rowText(row, "column_name"),
			Type:     rowText(row, "data_type"),
			Nullable: strings.ToUpper(rowText(row, "is_nullable")),
			Comment:  rowText(row, "column_comment"),
		}
		key := strings.ToUpper(rowText(row, "column_key"))
		extras := make([]string, 0, 2)
		if semantic := strings.ToUpper(rowText(row, "semantic_type")); semantic != "" {
			extras = append(extras, semantic)
		}
		switch key {
		case "PRI":
			column.Key = "PRI"
		case "TIME INDEX":
			extras = append(extras, "TIME INDEX")
		}
		column.Extra = strings.Join(extras, ", ")
		if value := firstMapValueOf(row, "column_default"); value != nil {
			text := fmt.Sprint(value)
			column.Default = &text
			column.HasDefault = true
		}
		columns = append(columns, column)
	}
	return columns, nil
}

// GetIndexes 读取 information_schema.key_column_usage：主键（tag 列）、TIME INDEX 与跳数/倒排/全文索引。
func (g *GreptimeDB) GetIndexes(dbName, tableName string) ([]connection.IndexDefinition, error) {
	rows, _, err := g.MySQLDB.Query(`SELECT constraint_name, column_name, ordinal_position, greptime_index_type
FROM information_schema.key_column_usage WHERE ` + greptimeDBTableFilter(dbName, tableName) + ` ORDER BY constraint_name, ordinal_position`)
	if err != nil {
		return nil, err
	}
	indexes := make([]connection.IndexDefinition, 0, len(rows))
	for _, row := range rows {
		name := rowText(row, "constraint_name")
		indexType := strings.ToUpper(rowText(row, "greptime_index_type"))
		if indexType == "" {
			indexType = strings.ToUpper(name)
		}
		nonUnique := 1
		if strings.EqualFold(name, "PRIMARY") {
			nonUnique = 0
		}
		seq := 0
		_, _ = fmt.Sscan(rowText(row, "ordinal_position"), &seq)
		indexes = append(indexes, connection.IndexDefinition{
			Name:       name,
			ColumnName: rowText(row, "column_name"),
			NonUnique:  nonUnique,
			SeqInIndex: seq,
			IndexType:  indexType,
		})
	}
	return indexes, nil
}

// GetForeignKeys GreptimeDB 没有外键。
func (g *GreptimeDB) GetForeignKeys(string, string) ([]connection.ForeignKeyDefinition, error) {
	return []connection.ForeignKeyDefinition{}, nil
}

// GetTriggers GreptimeDB 没有触发器（MySQL 的触发器查询会让服务端断开连接）。
func (g *GreptimeDB) GetTriggers(string, string) ([]connection.TriggerDefinition, error) {
	return []connection.TriggerDefinition{}, nil
}

// GetCreateStatement 视图用 SHOW CREATE VIEW，表沿用 MySQL 的 SHOW CREATE TABLE。
func (g *GreptimeDB) GetCreateStatement(dbName, tableName string) (string, error) {
	if g.isView(dbName, tableName) {
		rows, _, err := g.MySQLDB.Query("SHOW CREATE VIEW " + quoteGreptimeDBIdentifier(dbName, tableName))
		if err != nil {
			return "", err
		}
		if ddl := rowText(firstRowOf(rows), "Create View"); ddl != "" {
			return ddl, nil
		}
	}
	return g.MySQLDB.GetCreateStatement(dbName, tableName)
}

func (g *GreptimeDB) isView(dbName, tableName string) bool {
	rows, _, err := g.MySQLDB.Query("SELECT table_type FROM information_schema.tables WHERE " + greptimeDBTableFilter(dbName, tableName))
	return err == nil && len(rows) > 0 && strings.EqualFold(rowText(rows[0], "table_type"), "VIEW")
}

func firstRowOf(rows []map[string]interface{}) map[string]interface{} {
	if len(rows) == 0 {
		return nil
	}
	return rows[0]
}

func quoteGreptimeDBIdentifier(dbName, name string) string {
	quote := func(part string) string { return "`" + strings.ReplaceAll(part, "`", "``") + "`" }
	if strings.TrimSpace(dbName) == "" {
		return quote(name)
	}
	return quote(dbName) + "." + quote(name)
}

// ApplyChangesContext 拒绝表格编辑：GreptimeDB 不支持 UPDATE，同主键与时间的写入会覆盖旧行；
// 写入请在 SQL 编辑器里用 INSERT（覆盖）/ DELETE。
func (g *GreptimeDB) ApplyChangesContext(context.Context, string, connection.ChangeSet) error {
	return localizedDatabaseRuntimeError("db.backend.error.greptimedb_row_edit_unsupported", nil)
}

// ApplyChanges 与 ApplyChangesContext 保持一致。
func (g *GreptimeDB) ApplyChanges(tableName string, changes connection.ChangeSet) error {
	return g.ApplyChangesContext(context.Background(), tableName, changes)
}
