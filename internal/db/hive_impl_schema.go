//go:build gonavi_full_drivers || gonavi_hive_driver

package db

import (
	"context"
	"fmt"
	"strings"

	"GoNavi-Wails/internal/connection"
)

func quoteHiveIdent(name string) string {
	cleaned := strings.Trim(strings.TrimSpace(name), "`")
	return "`" + strings.ReplaceAll(cleaned, "`", "``") + "`"
}

func quoteHiveTable(dbName, tableName string) string {
	db, table := resolveHiveTableTarget(dbName, tableName, "")
	if db == "" {
		return quoteHiveIdent(table)
	}
	return quoteHiveIdent(db) + "." + quoteHiveIdent(table)
}

func resolveHiveTableTarget(dbName, tableName, defaultDB string) (string, string) {
	rawDB := strings.Trim(strings.TrimSpace(dbName), "`")
	rawTable := strings.TrimSpace(tableName)
	if schema, table := SplitSQLQualifiedNameForDialect(rawTable, "mysql"); table != "" {
		if schema != "" {
			return strings.Trim(schema, "`"), strings.Trim(table, "`")
		}
		rawTable = strings.Trim(table, "`")
	} else {
		rawTable = strings.Trim(rawTable, "`")
	}
	if rawDB == "" {
		rawDB = strings.Trim(strings.TrimSpace(defaultDB), "`")
	}
	return rawDB, rawTable
}

func (h *HiveDB) effectiveDatabase(dbName string) string {
	if db := strings.Trim(strings.TrimSpace(dbName), "`"); db != "" {
		return db
	}
	if db := strings.Trim(strings.TrimSpace(h.database), "`"); db != "" {
		return db
	}
	return defaultHiveDatabase
}

func (h *HiveDB) GetDatabases() ([]string, error) {
	rows, _, err := h.QueryContext(metadataContextFor(h), "SHOW DATABASES")
	if err != nil {
		return nil, err
	}
	databases := make([]string, 0, len(rows))
	for _, row := range rows {
		name := rowText(row, "database_name", "namespace", "database")
		if name == "" {
			name = firstRowValueText(row)
		}
		if name != "" {
			databases = append(databases, name)
		}
	}
	return databases, nil
}

func (h *HiveDB) GetTables(dbName string) ([]string, error) {
	ctx := metadataContextFor(h)
	targetDB := h.effectiveDatabase(dbName)
	rows, _, err := h.QueryContext(ctx, "SHOW TABLES IN "+quoteHiveIdent(targetDB))
	if err != nil {
		return nil, err
	}
	viewSet := make(map[string]struct{})
	if viewRows, _, viewErr := h.QueryContext(ctx, "SHOW VIEWS IN "+quoteHiveIdent(targetDB)); viewErr == nil {
		for _, row := range viewRows {
			vName := rowText(row, "tab_name", "view_name", "table_name")
			if vName == "" {
				vName = firstRowValueText(row)
			}
			if vName != "" {
				viewSet[strings.ToLower(vName)] = struct{}{}
			}
		}
	}
	tables := make([]string, 0, len(rows))
	for _, row := range rows {
		name := rowText(row, "tab_name", "table_name", "tableName", "name")
		if name == "" {
			name = firstRowValueText(row)
		}
		if name == "" {
			continue
		}
		if _, isView := viewSet[strings.ToLower(name)]; isView {
			continue
		}
		tables = append(tables, name)
	}
	return tables, nil
}

func (h *HiveDB) GetCreateStatement(dbName, tableName string) (string, error) {
	targetDB, targetTable := resolveHiveTableTarget(dbName, tableName, h.database)
	if targetTable == "" {
		return "", localizedDatabaseRuntimeError("db.backend.error.table_name_required", nil)
	}
	rows, _, err := h.QueryContext(metadataContextFor(h), "SHOW CREATE TABLE "+quoteHiveTable(targetDB, targetTable))
	if err != nil {
		return "", err
	}
	var lines []string
	for _, row := range rows {
		rawVal := firstMapValueOf(row, "createtab_stmt", "Create Table", "create_table")
		var line string
		if rawVal != nil {
			line = strings.TrimRight(fmt.Sprint(rawVal), "\r\n")
		}
		if strings.TrimSpace(line) == "" {
			line = firstRowValueText(row)
		}
		if strings.TrimSpace(line) != "" {
			lines = append(lines, line)
		}
	}
	ddl := strings.TrimSpace(strings.Join(lines, "\n"))
	if ddl == "" {
		return "", localizedDatabaseRuntimeError("db.backend.error.hive_ddl_empty", map[string]any{"name": targetTable})
	}
	return ddl, nil
}

func (h *HiveDB) GetColumns(dbName, tableName string) ([]connection.ColumnDefinition, error) {
	targetDB, targetTable := resolveHiveTableTarget(dbName, tableName, h.database)
	if targetTable == "" {
		return nil, localizedDatabaseRuntimeError("db.backend.error.table_name_required", nil)
	}
	rows, _, err := h.QueryContext(metadataContextFor(h), "DESCRIBE "+quoteHiveTable(targetDB, targetTable))
	if err != nil {
		return nil, err
	}
	return parseHiveDescribeRows(rows), nil
}

// parseHiveDescribeRows 解析 Hive DESCRIBE <table> 的输出行，识别普通列与 # Partition Information 分区键列。
func parseHiveDescribeRows(rows []map[string]interface{}) []connection.ColumnDefinition {
	columns := make([]connection.ColumnDefinition, 0, len(rows))
	indexByName := make(map[string]int, len(rows))
	inPartitionSection := false

	for _, row := range rows {
		colName := strings.TrimSpace(rowText(row, "col_name", "name", "column_name", "field"))
		dataType := strings.TrimSpace(rowText(row, "data_type", "type"))
		comment := strings.TrimSpace(rowText(row, "comment", "remarks"))
		if comment == "from deserializer" || strings.EqualFold(comment, "null") {
			comment = ""
		}

		if colName == "" {
			continue
		}
		if strings.HasPrefix(colName, "#") {
			lowerHeader := strings.ToLower(colName)
			switch {
			case strings.Contains(lowerHeader, "partition information"):
				inPartitionSection = true
			case strings.Contains(lowerHeader, "col_name"):
				// 表头行跳过，保持当前段落状态
			default:
				inPartitionSection = false
			}
			continue
		}
		if dataType == "" {
			continue
		}

		lowerName := strings.ToLower(colName)
		if inPartitionSection {
			if idx, exists := indexByName[lowerName]; exists {
				columns[idx].Extra = "PARTITION KEY"
				if comment != "" && columns[idx].Comment == "" {
					columns[idx].Comment = comment
				}
			} else {
				indexByName[lowerName] = len(columns)
				columns = append(columns, connection.ColumnDefinition{
					Name:     colName,
					Type:     dataType,
					Nullable: "YES",
					Comment:  comment,
					Extra:    "PARTITION KEY",
				})
			}
			continue
		}

		if _, exists := indexByName[lowerName]; exists {
			continue
		}
		indexByName[lowerName] = len(columns)
		columns = append(columns, connection.ColumnDefinition{
			Name:     colName,
			Type:     dataType,
			Nullable: "YES",
			Comment:  comment,
		})
	}
	return columns
}

func (h *HiveDB) GetAllColumns(dbName string) ([]connection.ColumnDefinitionWithTable, error) {
	ctx := metadataContextFor(h)
	targetDB := h.effectiveDatabase(dbName)
	if cols, err := h.fetchAllColumnsViaThrift(ctx, targetDB); err == nil && len(cols) > 0 {
		return cols, nil
	}
	tables, err := h.GetTables(targetDB)
	if err != nil {
		return nil, err
	}
	var all []connection.ColumnDefinitionWithTable
	for _, table := range tables {
		cols, colErr := h.GetColumns(targetDB, table)
		if colErr != nil {
			continue
		}
		for _, col := range cols {
			all = append(all, connection.ColumnDefinitionWithTable{
				TableName: table,
				Name:      col.Name,
				Type:      col.Type,
			})
		}
	}
	return all, nil
}

func (h *HiveDB) fetchAllColumnsViaThrift(ctx context.Context, dbName string) ([]connection.ColumnDefinitionWithTable, error) {
	h.execMu.Lock()
	defer h.execMu.Unlock()
	if h.transport == nil {
		return nil, localizedDatabaseRuntimeError("db.backend.error.connection_not_open", nil)
	}
	var op hiveOperationHandle
	var status hiveStatus
	err := h.transport.call(ctx, "GetColumns", func(w *hiveWriter) {
		w.writeFieldBegin(thriftTypeStruct, 1) // req
		w.writeFieldBegin(thriftTypeStruct, 1) // sessionHandle
		writeHiveSessionHandle(w, h.sessionID)
		w.writeFieldBegin(thriftTypeString, 3) // schemaName
		w.writeString(dbName)
		w.writeFieldBegin(thriftTypeString, 4) // tableName
		w.writeString("%")
		w.writeFieldBegin(thriftTypeString, 5) // columnName
		w.writeString("%")
		w.writeFieldStop()
	}, func(r *hiveReader) error {
		return readSingleStructField(r, func(r *hiveReader) error {
			for {
				ft, fid, err := r.readFieldBegin()
				if err != nil {
					return wrapHiveProtocolError(err)
				}
				if ft == thriftTypeStop {
					return nil
				}
				switch {
				case fid == 1 && ft == thriftTypeStruct:
					if status, err = readHiveStatus(r); err != nil {
						return wrapHiveProtocolError(err)
					}
				case fid == 2 && ft == thriftTypeStruct:
					if op, err = readHiveOperationHandle(r); err != nil {
						return wrapHiveProtocolError(err)
					}
				default:
					if err := r.skip(ft); err != nil {
						return wrapHiveProtocolError(err)
					}
				}
			}
		})
	})
	if err != nil {
		return nil, err
	}
	if err := status.toError(); err != nil {
		return nil, err
	}
	defer func() {
		cctx, cancel := context.WithTimeout(context.Background(), hiveCancelTimeout)
		defer cancel()
		_ = h.transport.closeOperation(cctx, op)
	}()
	cancelOp := func() {
		cctx, cancel := context.WithTimeout(context.Background(), hiveCancelTimeout)
		defer cancel()
		_ = h.transport.cancelOperation(cctx, op)
	}
	if _, err := h.waitOperationFinished(ctx, op, cancelOp); err != nil {
		return nil, err
	}

	collector := &hiveRowCollector{}
	colsMeta, err := h.transport.getResultSetMetadata(ctx, op)
	if err != nil {
		return nil, err
	}
	if err := collector.onColumns(uniqueHiveColumnNames(colsMeta)); err != nil {
		return nil, err
	}
	for {
		batch, fetchErr := h.transport.fetchResults(ctx, op, hiveFetchNext, defaultHiveFetchBatchSize)
		if fetchErr != nil {
			return nil, fetchErr
		}
		if len(batch) == 0 {
			break
		}
		for _, row := range batch {
			if err := collector.onRow(row); err != nil {
				return nil, err
			}
		}
	}
	result := make([]connection.ColumnDefinitionWithTable, 0, len(collector.data))
	for _, row := range collector.data {
		tableName := rowText(row, "TABLE_NAME", "table_name")
		colName := rowText(row, "COLUMN_NAME", "column_name")
		typeName := rowText(row, "TYPE_NAME", "type_name", "DATA_TYPE")
		if tableName != "" && colName != "" {
			result = append(result, connection.ColumnDefinitionWithTable{
				TableName: tableName,
				Name:      colName,
				Type:      typeName,
			})
		}
	}
	return result, nil
}

func (h *HiveDB) GetIndexes(string, string) ([]connection.IndexDefinition, error) {
	return []connection.IndexDefinition{}, nil
}

func (h *HiveDB) GetForeignKeys(string, string) ([]connection.ForeignKeyDefinition, error) {
	return []connection.ForeignKeyDefinition{}, nil
}

func (h *HiveDB) GetTriggers(string, string) ([]connection.TriggerDefinition, error) {
	return []connection.TriggerDefinition{}, nil
}

func (h *HiveDB) ApplyChangesContext(ctx context.Context, tableName string, changes connection.ChangeSet) error {
	reject := localizedDatabaseRuntimeError("db.backend.error.hive_row_edit_unsupported", nil)
	if len(changes.Updates) > 0 || len(changes.Deletes) > 0 {
		return reject
	}
	targetDB, targetTable := resolveHiveTableTarget("", tableName, h.database)
	columns, _ := h.GetColumns(targetDB, targetTable)
	return applyInsertOnlyChanges(ctx, h.ExecContext, columns, targetTable, changes, insertOnlyDialect{
		quoteTable:       func(name string) string { return quoteHiveTable(targetDB, name) },
		quoteIdent:       quoteHiveIdent,
		escapeBackslash:  true,
		rowsPerStatement: 200,
	}, reject)
}

func (h *HiveDB) ApplyChanges(tableName string, changes connection.ChangeSet) error {
	return h.ApplyChangesContext(context.Background(), tableName, changes)
}

func firstRowValueText(row map[string]interface{}) string {
	for _, value := range row {
		if value != nil {
			if text := strings.TrimSpace(rowText(map[string]interface{}{"v": value}, "v")); text != "" {
				return text
			}
		}
	}
	return ""
}
