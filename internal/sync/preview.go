package sync

import (
	"fmt"
	"strings"
)

type PreviewRow struct {
	PK  string                 `json:"pk"`
	Row map[string]interface{} `json:"row"`
}

type PreviewUpdateRow struct {
	PK             string                 `json:"pk"`
	ChangedColumns []string               `json:"changedColumns"`
	Source         map[string]interface{} `json:"source"`
	Target         map[string]interface{} `json:"target"`
}

type TableDiffPreview struct {
	Table            string             `json:"table"`
	PKColumn         string             `json:"pkColumn"`
	ColumnTypes      map[string]string  `json:"columnTypes,omitempty"`
	SchemaSummary    string             `json:"schemaSummary,omitempty"`
	SchemaWarnings   []string           `json:"schemaWarnings,omitempty"`
	SchemaStatements []string           `json:"schemaStatements,omitempty"`
	TotalInserts     int                `json:"totalInserts"`
	TotalUpdates     int                `json:"totalUpdates"`
	TotalDeletes     int                `json:"totalDeletes"`
	Inserts          []PreviewRow       `json:"inserts"`
	Updates          []PreviewUpdateRow `json:"updates"`
	Deletes          []PreviewRow       `json:"deletes"`
}

func (s *SyncEngine) Preview(config SyncConfig, tableName string, limit int) (TableDiffPreview, error) {
	config = normalizeSyncConnectionDatabases(config)
	config = normalizeMappedSyncTables(config)
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}
	if err := validateSyncMappings(config); err != nil {
		return TableDiffPreview{}, err
	}
	if isRedisToMongoKeyspacePair(config) {
		return s.previewRedisToMongo(config, tableName, limit)
	}
	if isMongoToRedisKeyspacePair(config) {
		return s.previewMongoToRedis(config, tableName, limit)
	}
	if hasSourceQuery(config) {
		return s.previewSourceQuery(config, limit)
	}
	if err := ValidateMigrationCapability(config); err != nil {
		return TableDiffPreview{}, err
	}

	sourceDB, err := newSyncDatabase(config.SourceConfig.Type)
	if err != nil {
		return TableDiffPreview{}, syncWrapDetailError("data_sync.backend.error.init_source_driver_failed", err)
	}
	targetDB, err := newSyncDatabase(config.TargetConfig.Type)
	if err != nil {
		return TableDiffPreview{}, syncWrapDetailError("data_sync.backend.error.init_target_driver_failed", err)
	}

	if err := sourceDB.Connect(config.SourceConfig); err != nil {
		return TableDiffPreview{}, syncWrapDetailError("data_sync.backend.error.connect_source_failed", err)
	}
	defer sourceDB.Close()

	if err := targetDB.Connect(config.TargetConfig); err != nil {
		return TableDiffPreview{}, syncWrapDetailError("data_sync.backend.error.connect_target_failed", err)
	}
	defer targetDB.Close()

	plan, cols, targetCols, err := buildSchemaMigrationPlan(config, tableName, sourceDB, targetDB)
	if err != nil {
		return TableDiffPreview{}, err
	}
	if !plan.TargetTableExists && !plan.AutoCreate {
		return TableDiffPreview{}, syncTextError("data_sync.plan.target_missing_preview_unavailable", nil)
	}
	projection, err := projectionForSyncTable(config, tableName)
	if err != nil {
		return TableDiffPreview{}, err
	}
	schemaStatements := make([]string, 0, len(plan.PreDataSQL)+len(plan.PostDataSQL))
	schemaStatements = append(schemaStatements, plan.PreDataSQL...)
	schemaStatements = append(schemaStatements, plan.PostDataSQL...)

	contentRaw := strings.ToLower(strings.TrimSpace(config.Content))
	if contentRaw == "schema" {
		return TableDiffPreview{
			Table:            tableName,
			SchemaSummary:    firstNonEmpty(plan.PlannedAction, "仅同步结构"),
			SchemaWarnings:   append([]string(nil), plan.Warnings...),
			SchemaStatements: append([]string(nil), schemaStatements...),
		}, nil
	}

	pkCols, err := syncKeyColumnsForTable(config, tableName, cols)
	if err != nil {
		return TableDiffPreview{}, err
	}
	if len(pkCols) == 0 {
		return TableDiffPreview{}, syncTextError("data_sync.backend.error.preview_pk_required", nil)
	}
	if len(pkCols) > 1 {
		return TableDiffPreview{}, syncTextError("data_sync.backend.error.preview_composite_pk_unsupported", map[string]any{
			"columns": strings.Join(pkCols, ","),
		})
	}
	sourcePKCol := pkCols[0]
	pkCol := sourcePKCol
	if hasExplicitSyncMappings(config) {
		mappedPK, ok := projection.TargetColumn(sourcePKCol)
		if !ok || strings.TrimSpace(mappedPK) == "" {
			return TableDiffPreview{}, fmt.Errorf("表 %s 的主键字段 %s 未映射到目标字段，无法生成差异预览", tableName, sourcePKCol)
		}
		pkCol = mappedPK
	}

	sourceType := resolveMigrationDBType(config.SourceConfig)
	targetType := resolveMigrationDBType(config.TargetConfig)
	out := TableDiffPreview{
		Table:            tableName,
		PKColumn:         pkCol,
		ColumnTypes:      make(map[string]string, len(cols)),
		SchemaSummary:    firstNonEmpty(plan.PlannedAction, "结构预览"),
		SchemaWarnings:   append([]string(nil), plan.Warnings...),
		SchemaStatements: append([]string(nil), schemaStatements...),
		TotalInserts:     0,
		TotalUpdates:     0,
		TotalDeletes:     0,
		Inserts:          make([]PreviewRow, 0),
		Updates:          make([]PreviewUpdateRow, 0),
		Deletes:          make([]PreviewRow, 0),
	}
	columnTypes := cols
	if hasExplicitSyncMappings(config) {
		columnTypes = targetCols
	}
	for _, col := range columnTypes {
		name := strings.ToLower(strings.TrimSpace(col.Name))
		typ := strings.TrimSpace(col.Type)
		if name == "" || typ == "" {
			continue
		}
		out.ColumnTypes[name] = typ
	}

	tableMode := normalizeSyncMode(config.Mode)
	targetColSet := map[string]struct{}{}
	if plan.TargetTableExists {
		resolvedTargetCols := targetCols
		if len(resolvedTargetCols) == 0 {
			resolvedTargetCols, err = targetDB.GetColumns(plan.TargetSchema, plan.TargetTable)
		}
		if err == nil {
			targetColSet = buildTargetColumnSet(resolvedTargetCols)
		}
	}

	if !plan.TargetTableExists || tableMode != "insert_update" {
		sourceCount, counted, err := countTableRowsForSync(sourceDB, sourceType, plan.SourceQueryTable)
		if err != nil {
			return TableDiffPreview{}, fmt.Errorf("读取源表数量失败: %w", err)
		}
		query := buildPagedSourceTableQuery(sourceType, plan.SourceQueryTable, cols, sourcePKCol, limit, 0)
		if strings.TrimSpace(query) == "" {
			return TableDiffPreview{}, fmt.Errorf("当前数据源不支持分页预览")
		}
		sourceRows, _, err := sourceDB.Query(query)
		if err != nil {
			return TableDiffPreview{}, fmt.Errorf("读取源表失败: %w", err)
		}
		if hasExplicitSyncMappings(config) {
			sourceRows, err = projectSyncRows(projection, sourceRows)
			if err != nil {
				return TableDiffPreview{}, err
			}
		}
		if !counted {
			sourceCount = len(sourceRows)
		}
		out.TotalInserts = sourceCount
		for _, row := range sourceRows {
			if len(out.Inserts) >= limit {
				break
			}
			pkVal := strings.TrimSpace(fmt.Sprintf("%v", row[pkCol]))
			if pkVal == "" || pkVal == "<nil>" {
				continue
			}
			out.Inserts = append(out.Inserts, PreviewRow{PK: pkVal, Row: row})
		}
		return out, nil
	}

	handled := false
	if !hasExplicitSyncMappings(config) {
		handled, _, err = scanTableDiffInPages(sourceDB, targetDB, sourceType, targetType, plan, cols, nil, sourcePKCol, targetColSet, true, func(page pagedDiffPage) error {
			out.TotalInserts += len(page.Inserts)
			out.TotalUpdates += len(page.Updates)
			out.TotalDeletes += len(page.Deletes)

			for _, row := range page.Inserts {
				if len(out.Inserts) >= limit {
					break
				}
				pkVal := strings.TrimSpace(fmt.Sprintf("%v", row[pkCol]))
				if pkVal == "" || pkVal == "<nil>" {
					continue
				}
				out.Inserts = append(out.Inserts, PreviewRow{PK: pkVal, Row: row})
			}
			for _, update := range page.Updates {
				if len(out.Updates) >= limit {
					break
				}
				pkVal := strings.TrimSpace(fmt.Sprintf("%v", update.UpdateRow.Keys[pkCol]))
				if pkVal == "" || pkVal == "<nil>" {
					continue
				}
				out.Updates = append(out.Updates, PreviewUpdateRow{
					PK:             pkVal,
					ChangedColumns: append([]string(nil), update.ChangedColumns...),
					Source:         update.Source,
					Target:         update.Target,
				})
			}
			for _, row := range page.Deletes {
				if len(out.Deletes) >= limit {
					break
				}
				pkVal := strings.TrimSpace(fmt.Sprintf("%v", row[pkCol]))
				if pkVal == "" || pkVal == "<nil>" {
					continue
				}
				out.Deletes = append(out.Deletes, PreviewRow{PK: pkVal, Row: row})
			}
			return nil
		})
	}
	if handled {
		if err != nil {
			return TableDiffPreview{}, err
		}
		return out, nil
	}

	sourceRows, _, err := sourceDB.Query(fmt.Sprintf("SELECT * FROM %s", quoteQualifiedIdentByType(sourceType, plan.SourceQueryTable)))
	if err != nil {
		return TableDiffPreview{}, fmt.Errorf("读取源表失败: %w", err)
	}
	if hasExplicitSyncMappings(config) {
		sourceRows, err = projectSyncRows(projection, sourceRows)
		if err != nil {
			return TableDiffPreview{}, err
		}
	}

	targetRows := make([]map[string]interface{}, 0)
	if plan.TargetTableExists {
		targetRows, _, err = targetDB.Query(fmt.Sprintf("SELECT * FROM %s", quoteQualifiedIdentByType(targetType, plan.TargetQueryTable)))
		if err != nil {
			return TableDiffPreview{}, fmt.Errorf("读取目标表失败: %w", err)
		}
	}

	targetMap := make(map[string]map[string]interface{}, len(targetRows))
	for _, row := range targetRows {
		if row[pkCol] == nil {
			continue
		}
		pkVal := strings.TrimSpace(fmt.Sprintf("%v", row[pkCol]))
		if pkVal == "" || pkVal == "<nil>" {
			continue
		}
		targetMap[pkVal] = row
	}

	sourcePKSet := make(map[string]struct{}, len(sourceRows))
	for _, sRow := range sourceRows {
		if sRow[pkCol] == nil {
			continue
		}
		pkVal := strings.TrimSpace(fmt.Sprintf("%v", sRow[pkCol]))
		if pkVal == "" || pkVal == "<nil>" {
			continue
		}
		sourcePKSet[pkVal] = struct{}{}

		if tRow, exists := targetMap[pkVal]; exists {
			changedColumns := make([]string, 0)
			for k, v := range sRow {
				if fmt.Sprintf("%v", v) != fmt.Sprintf("%v", tRow[k]) {
					changedColumns = append(changedColumns, k)
				}
			}
			if len(changedColumns) > 0 {
				out.TotalUpdates++
				if len(out.Updates) < limit {
					out.Updates = append(out.Updates, PreviewUpdateRow{PK: pkVal, ChangedColumns: changedColumns, Source: sRow, Target: tRow})
				}
			}
			continue
		}

		out.TotalInserts++
		if len(out.Inserts) < limit {
			out.Inserts = append(out.Inserts, PreviewRow{PK: pkVal, Row: sRow})
		}
	}

	for pkVal, row := range targetMap {
		if _, ok := sourcePKSet[pkVal]; ok {
			continue
		}
		out.TotalDeletes++
		if len(out.Deletes) < limit {
			out.Deletes = append(out.Deletes, PreviewRow{PK: pkVal, Row: row})
		}
	}

	return out, nil
}
