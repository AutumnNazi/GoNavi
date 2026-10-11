package app

import (
	"context"
	"errors"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/mockdata"
)

// mockDataTable 是生成模拟数据所需的目标表信息：列画像、外键可选值和数据库实例。
type mockDataTable struct {
	dbInst   db.Database
	dbType   string
	family   mockdata.Family
	columns  []connection.ColumnDefinition
	profiles []mockdata.Profile
	refs     mockdata.References
}

// loadMockDataTable 读取列、索引与外键，补齐 PG 自定义枚举、整数主键的 MAX+1 和外键父表取值。
// 索引与外键读取失败不阻断：最多少一些约束推断，写入时由数据库兜底报错。
//
// 元数据走 App 的缓存连接（与桌面端 DataGrid 读列相同），不用 *Context 版本：
// 那些版本每次新建独立元数据会话，SSH 转发下列、索引、外键三次各要重新建连约 3 秒。
func (a *App) loadMockDataTable(ctx context.Context, config connection.ConnectionConfig, dbName, tableName string) (*mockDataTable, error) {
	runConfig := normalizeRunConfig(config, dbName)
	dbInst, err := a.getDatabaseSynchronouslyWithContext(ctx, runConfig, false)
	if err != nil {
		return nil, err
	}
	columnsResult := a.DBGetColumns(config, dbName, tableName)
	if !columnsResult.Success {
		return nil, errors.New(columnsResult.Message)
	}
	columns, _ := columnsResult.Data.([]connection.ColumnDefinition)
	if len(columns) == 0 {
		return nil, errors.New(a.appText("mock_data.backend.error.no_table_columns", map[string]any{"table": tableName}))
	}
	dbType := resolveDDLDBType(config)
	table := &mockDataTable{
		dbInst:  dbInst,
		dbType:  dbType,
		family:  mockdata.ResolveFamily(dbType),
		columns: columns,
	}
	keys := a.loadMockDataKeys(config, dbName, tableName)
	table.profiles = mockdata.ClassifyTable(table.family, columns, keys)
	a.fillMockDataLookups(ctx, table, dbName, tableName)
	return table, nil
}

func (a *App) loadMockDataKeys(config connection.ConnectionConfig, dbName, tableName string) mockdata.TableKeys {
	var indexes []connection.IndexDefinition
	if result := a.DBGetIndexes(config, dbName, tableName); result.Success {
		indexes, _ = result.Data.([]connection.IndexDefinition)
	} else {
		logger.Warnf("模拟数据读取索引失败，跳过唯一约束推断：表=%s.%s", dbName, tableName)
	}
	var foreignKeys []connection.ForeignKeyDefinition
	if result := a.DBGetForeignKeys(config, dbName, tableName); result.Success {
		foreignKeys, _ = result.Data.([]connection.ForeignKeyDefinition)
	} else {
		logger.Warnf("模拟数据读取外键失败，跳过外键引用：表=%s.%s", dbName, tableName)
	}
	return mockDataKeysFromMetadata(indexes, foreignKeys)
}

// mockDataKeysFromMetadata 按索引名分组得到主键与唯一约束；主键名的判断与前端 DataGrid 一致。
func mockDataKeysFromMetadata(indexes []connection.IndexDefinition, foreignKeys []connection.ForeignKeyDefinition) mockdata.TableKeys {
	type group struct {
		primary bool
		columns []connection.IndexDefinition
	}
	groups := map[string]*group{}
	var order []string
	for _, index := range indexes {
		if index.NonUnique != 0 || strings.TrimSpace(index.ColumnName) == "" {
			continue
		}
		current, ok := groups[index.Name]
		if !ok {
			current = &group{primary: isPrimaryIndexName(index.Name, index.IndexType)}
			groups[index.Name] = current
			order = append(order, index.Name)
		}
		current.columns = append(current.columns, index)
	}
	keys := mockdata.TableKeys{ForeignKeys: map[string]mockdata.ForeignKey{}}
	for _, name := range order {
		current := groups[name]
		slices.SortStableFunc(current.columns, func(a, b connection.IndexDefinition) int { return a.SeqInIndex - b.SeqInIndex })
		columns := make([]string, 0, len(current.columns))
		for _, column := range current.columns {
			columns = append(columns, column.ColumnName)
		}
		if current.primary && len(keys.PrimaryKey) == 0 {
			keys.PrimaryKey = columns
			continue
		}
		keys.Unique = append(keys.Unique, columns)
	}
	for _, fk := range foreignKeys {
		column := strings.ToLower(strings.TrimSpace(fk.ColumnName))
		if column == "" || strings.TrimSpace(fk.RefTableName) == "" || strings.TrimSpace(fk.RefColumnName) == "" {
			continue
		}
		keys.ForeignKeys[column] = mockdata.ForeignKey{Table: fk.RefTableName, Column: fk.RefColumnName}
	}
	return keys
}

func isPrimaryIndexName(name, indexType string) bool {
	normalizedName := strings.ToLower(strings.TrimSpace(name))
	normalizedType := strings.ToLower(strings.TrimSpace(indexType))
	return normalizedName == "primary" || normalizedName == "primary key" || strings.HasSuffix(normalizedName, "_pkey") ||
		strings.HasPrefix(normalizedName, "pk_") || normalizedType == "primary" || normalizedType == "primary key"
}

// fillMockDataLookups 查库补齐静态元数据给不出的信息；单项失败只记日志。
func (a *App) fillMockDataLookups(ctx context.Context, table *mockDataTable, dbName, tableName string) {
	schemaName, pureTableName := normalizeSchemaAndTableByType(table.dbType, dbName, tableName)
	qualifiedTable := quoteTableIdentByType(table.dbType, schemaName, pureTableName)
	table.refs = mockdata.References{}
	for i := range table.profiles {
		profile := &table.profiles[i]
		if mockdata.NeedsEnumLookup(*profile) {
			labels, err := queryFirstColumnTexts(ctx, table.dbInst, mockdata.PostgresEnumLabelsQuery(profile.Type))
			if err == nil {
				profile.ApplyEnumValues(labels)
			}
		}
		if mockdata.NeedsNextValue(*profile) {
			a.fillMockDataNextValue(ctx, table, profile, qualifiedTable)
		}
		if profile.ForeignKey != nil {
			refSchema, refTable := normalizeSchemaAndTableByType(table.dbType, dbName, profile.ForeignKey.Table)
			query := mockdata.DistinctSampleQuery(table.family, quoteTableIdentByType(table.dbType, refSchema, refTable),
				quoteIdentByType(table.dbType, profile.ForeignKey.Column), mockdata.MaxReferenceSample)
			values, err := queryFirstColumnTexts(ctx, table.dbInst, query)
			if err != nil {
				logger.Warnf("模拟数据读取外键父表取值失败：表=%s 列=%s 错误=%v", profile.ForeignKey.Table, profile.ForeignKey.Column, err)
				continue
			}
			table.refs[strings.ToLower(profile.Name)] = mockdata.NormalizeSample(values)
		}
	}
}

func (a *App) fillMockDataNextValue(ctx context.Context, table *mockDataTable, profile *mockdata.Profile, qualifiedTable string) {
	values, err := queryFirstColumnTexts(ctx, table.dbInst, mockdata.MaxValueQuery(qualifiedTable, quoteIdentByType(table.dbType, profile.Name)))
	if err != nil {
		logger.Warnf("模拟数据读取列最大值失败：列=%s 错误=%v", profile.Name, err)
		return
	}
	if len(values) == 0 {
		profile.SetNextValue("1")
		return
	}
	intPart, _, _ := strings.Cut(strings.TrimSpace(values[0]), ".")
	current, parseErr := strconv.ParseInt(intPart, 10, 64)
	if parseErr != nil || current == math.MaxInt64 {
		return
	}
	profile.SetNextValue(strconv.FormatInt(current+1, 10))
}

// queryFirstColumnTexts 执行只读查询并把首列转成文本，NULL 跳过。
func queryFirstColumnTexts(ctx context.Context, dbInst db.Database, query string) ([]string, error) {
	var rows []map[string]interface{}
	var columns []string
	var err error
	if contextQuerier, ok := dbInst.(db.QueryContexter); ok {
		rows, columns, err = contextQuerier.QueryContext(ctx, query)
	} else {
		rows, columns, err = dbInst.Query(query)
	}
	if err != nil {
		return nil, err
	}
	if len(columns) == 0 {
		return nil, nil
	}
	values := make([]string, 0, len(rows))
	for _, row := range rows {
		value, ok := row[columns[0]]
		if !ok || value == nil {
			continue
		}
		values = append(values, mockDataValueText(value))
	}
	return values, nil
}

func mockDataValueText(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []byte:
		return string(typed)
	case time.Time:
		if typed.Hour() == 0 && typed.Minute() == 0 && typed.Second() == 0 && typed.Nanosecond() == 0 {
			return typed.Format("2006-01-02")
		}
		return typed.Format("2006-01-02 15:04:05")
	}
	return fmt.Sprint(value)
}
