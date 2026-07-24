package app

import (
	"bufio"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

const (
	defaultImportPreviewLimit   = 5
	defaultImportApplyBatchSize = 1000
)

type importFileConsumer interface {
	SetColumns(columns []string) error
	ConsumeRow(row map[string]interface{}) error
}

type importPreviewData struct {
	Columns     []string
	TotalRows   int
	PreviewRows []map[string]interface{}
}

// ImportFileOptions controls how a selected import file is applied to the target table.
// A nil ColumnMappings value preserves the legacy behavior where file headers are used
// directly as database column names. A non-nil map enables explicit source-to-target
// mapping; entries with an empty target are skipped.
type ImportFileOptions struct {
	ColumnMappings map[string]string `json:"columnMappings,omitempty"`
	JobID          string            `json:"jobId,omitempty"`
}

type importProgressState struct {
	JobID          string `json:"jobId,omitempty"`
	Current        int    `json:"current"`
	Total          int    `json:"total,omitempty"`
	Success        int    `json:"success"`
	Errors         int    `json:"errors"`
	TotalRowsKnown bool   `json:"totalRowsKnown,omitempty"`
}

type importExecutionResult struct {
	Success   int
	Failed    int
	Total     int
	ErrorLogs []string
}

type importPreviewCollector struct {
	columns      []string
	totalRows    int
	previewRows  []map[string]interface{}
	previewLimit int
}

func newImportPreviewCollector(limit int) *importPreviewCollector {
	if limit <= 0 {
		limit = defaultImportPreviewLimit
	}
	return &importPreviewCollector{previewLimit: limit}
}

func (c *importPreviewCollector) SetColumns(columns []string) error {
	c.columns = append([]string(nil), columns...)
	return nil
}

func (c *importPreviewCollector) ConsumeRow(row map[string]interface{}) error {
	c.totalRows++
	if len(c.previewRows) < c.previewLimit {
		c.previewRows = append(c.previewRows, cloneImportRow(row))
	}
	return nil
}

func (c *importPreviewCollector) Result() importPreviewData {
	return importPreviewData{
		Columns:     append([]string(nil), c.columns...),
		TotalRows:   c.totalRows,
		PreviewRows: cloneImportRows(c.previewRows),
	}
}

type importCollectConsumer struct {
	columns []string
	rows    []map[string]interface{}
}

func (c *importCollectConsumer) SetColumns(columns []string) error {
	c.columns = append([]string(nil), columns...)
	return nil
}

func (c *importCollectConsumer) ConsumeRow(row map[string]interface{}) error {
	c.rows = append(c.rows, cloneImportRow(row))
	return nil
}

type importResolvedColumnMapping struct {
	source string
	target string
}

type importColumnMappingConsumer struct {
	downstream       importFileConsumer
	targetBySource   map[string]string
	selectedSources  []string
	resolvedMappings []importResolvedColumnMapping
}

func newImportColumnMappingConsumer(
	downstream importFileConsumer,
	columnMappings map[string]string,
	targetColumns []connection.ColumnDefinition,
) (importFileConsumer, error) {
	if columnMappings == nil {
		return downstream, nil
	}
	if downstream == nil {
		return nil, fmt.Errorf("导入字段映射缺少下游处理器")
	}

	targetColumnsByExactName := make(map[string]string, len(targetColumns))
	targetColumnsByFoldedName := make(map[string][]string, len(targetColumns))
	for _, column := range targetColumns {
		name := column.Name
		if strings.TrimSpace(name) == "" {
			continue
		}
		targetColumnsByExactName[name] = name
		foldedName := normalizeColumnName(name)
		targetColumnsByFoldedName[foldedName] = append(targetColumnsByFoldedName[foldedName], name)
	}

	sources := make([]string, 0, len(columnMappings))
	for source := range columnMappings {
		sources = append(sources, source)
	}
	sort.Strings(sources)

	targetBySource := make(map[string]string, len(columnMappings))
	selectedSources := make([]string, 0, len(columnMappings))
	usedTargets := make(map[string]string, len(columnMappings))
	for _, source := range sources {
		if strings.TrimSpace(source) == "" {
			return nil, fmt.Errorf("导入字段映射源字段不能为空")
		}
		requestedTarget := columnMappings[source]
		if strings.TrimSpace(requestedTarget) == "" {
			continue
		}

		actualTarget, exactMatch := targetColumnsByExactName[requestedTarget]
		if !exactMatch {
			foldedMatches := targetColumnsByFoldedName[normalizeColumnName(requestedTarget)]
			switch len(foldedMatches) {
			case 0:
				return nil, fmt.Errorf("导入字段映射目标字段 %q 不存在", requestedTarget)
			case 1:
				actualTarget = foldedMatches[0]
			default:
				return nil, fmt.Errorf("导入字段映射目标字段 %q 的大小写匹配不明确", requestedTarget)
			}
		}
		if previousSource, exists := usedTargets[actualTarget]; exists {
			return nil, fmt.Errorf("导入字段映射目标字段 %q 被源字段 %q 和 %q 重复使用", actualTarget, previousSource, source)
		}
		usedTargets[actualTarget] = source
		targetBySource[source] = actualTarget
		selectedSources = append(selectedSources, source)
	}
	if len(selectedSources) == 0 {
		return nil, fmt.Errorf("导入字段映射至少需要选择一个目标字段")
	}

	return &importColumnMappingConsumer{
		downstream:      downstream,
		targetBySource:  targetBySource,
		selectedSources: selectedSources,
	}, nil
}

func (c *importColumnMappingConsumer) SetColumns(columns []string) error {
	if c == nil || c.downstream == nil {
		return fmt.Errorf("导入字段映射缺少下游处理器")
	}

	foundSources := make(map[string]struct{}, len(c.selectedSources))
	resolved := make([]importResolvedColumnMapping, 0, len(c.selectedSources))
	targets := make([]string, 0, len(c.selectedSources))
	for _, source := range columns {
		target, selected := c.targetBySource[source]
		if !selected {
			continue
		}
		if _, duplicate := foundSources[source]; duplicate {
			return fmt.Errorf("导入字段映射源字段 %q 在文件表头中重复", source)
		}
		foundSources[source] = struct{}{}
		resolved = append(resolved, importResolvedColumnMapping{source: source, target: target})
		targets = append(targets, target)
	}
	for _, source := range c.selectedSources {
		if _, ok := foundSources[source]; !ok {
			return fmt.Errorf("导入字段映射源字段 %q 不存在", source)
		}
	}

	c.resolvedMappings = resolved
	return c.downstream.SetColumns(targets)
}

func (c *importColumnMappingConsumer) ConsumeRow(row map[string]interface{}) error {
	if c == nil || c.downstream == nil {
		return fmt.Errorf("导入字段映射缺少下游处理器")
	}
	if len(c.resolvedMappings) == 0 {
		return fmt.Errorf("导入字段映射尚未解析文件表头")
	}

	mappedRow := make(map[string]interface{}, len(c.resolvedMappings))
	for _, mapping := range c.resolvedMappings {
		mappedRow[mapping.target] = row[mapping.source]
	}
	return c.downstream.ConsumeRow(mappedRow)
}

type importRowWriter interface {
	SetColumns(columns []string)
	ApplyBatch(rows []map[string]interface{}) error
	ApplyOne(row map[string]interface{}) error
	BatchEnabled() bool
}

type importColumnTypeLookup struct {
	byExactName  map[string]string
	byFoldedName map[string][]string
}

func newImportColumnTypeLookup(columns []connection.ColumnDefinition) importColumnTypeLookup {
	lookup := importColumnTypeLookup{
		byExactName:  make(map[string]string, len(columns)),
		byFoldedName: make(map[string][]string, len(columns)),
	}
	for _, column := range columns {
		name := column.Name
		if strings.TrimSpace(name) == "" {
			continue
		}
		if _, exists := lookup.byExactName[name]; !exists {
			foldedName := normalizeColumnName(name)
			lookup.byFoldedName[foldedName] = append(lookup.byFoldedName[foldedName], name)
		}
		lookup.byExactName[name] = strings.TrimSpace(column.Type)
	}
	return lookup
}

func (l importColumnTypeLookup) Resolve(columnName string) string {
	if columnType, ok := l.byExactName[columnName]; ok {
		return columnType
	}
	foldedMatches := l.byFoldedName[normalizeColumnName(columnName)]
	if len(foldedMatches) != 1 {
		return ""
	}
	return l.byExactName[foldedMatches[0]]
}

type importDatabaseRowWriter struct {
	dbInst      db.Database
	applier     db.BatchApplier
	dbType      string
	tableName   string
	columns     []string
	columnTypes importColumnTypeLookup
}

func newImportDatabaseRowWriter(dbInst db.Database, dbType, tableName string, columnTypes importColumnTypeLookup) *importDatabaseRowWriter {
	writer := &importDatabaseRowWriter{
		dbInst:      dbInst,
		dbType:      dbType,
		tableName:   tableName,
		columnTypes: columnTypes,
	}
	if applier, ok := dbInst.(db.BatchApplier); ok {
		writer.applier = applier
	}
	return writer
}

func (w *importDatabaseRowWriter) SetColumns(columns []string) {
	w.columns = append([]string(nil), columns...)
}

func (w *importDatabaseRowWriter) BatchEnabled() bool {
	return w.applier != nil
}

func (w *importDatabaseRowWriter) ApplyBatch(rows []map[string]interface{}) error {
	if w.applier == nil {
		return fmt.Errorf("当前数据库类型不支持批量提交")
	}
	return w.applier.ApplyChanges(w.tableName, connection.ChangeSet{Inserts: cloneImportRows(rows)})
}

func (w *importDatabaseRowWriter) ApplyOne(row map[string]interface{}) error {
	if w.applier != nil {
		return w.applier.ApplyChanges(w.tableName, connection.ChangeSet{Inserts: []map[string]interface{}{cloneImportRow(row)}})
	}
	query, err := buildImportInsertQuery(w.dbType, w.tableName, w.columns, row, w.columnTypes)
	if err != nil {
		return err
	}
	_, err = w.dbInst.Exec(query)
	return err
}

type importBatchConsumer struct {
	writer         importRowWriter
	ctx            context.Context
	jobID          string
	batchSize      int
	totalRows      int
	totalRowsKnown bool
	report         func(importProgressState)
	batch          []map[string]interface{}
	batchStartRow  int
	currentRow     int
	successCount   int
	errorLogs      []string
}

func newImportBatchConsumer(writer importRowWriter, batchSize int, totalRows int, totalRowsKnown bool, report func(importProgressState)) *importBatchConsumer {
	if batchSize <= 0 {
		batchSize = defaultImportApplyBatchSize
	}
	return &importBatchConsumer{
		writer:         writer,
		ctx:            context.Background(),
		batchSize:      batchSize,
		totalRows:      totalRows,
		totalRowsKnown: totalRowsKnown,
		report:         report,
	}
}

func (c *importBatchConsumer) SetContext(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}
	c.ctx = ctx
}

func (c *importBatchConsumer) contextError() error {
	if c == nil || c.ctx == nil {
		return nil
	}
	return c.ctx.Err()
}

func (c *importBatchConsumer) SetColumns(columns []string) error {
	if err := c.contextError(); err != nil {
		return err
	}
	if c.writer != nil {
		c.writer.SetColumns(columns)
	}
	return nil
}

func (c *importBatchConsumer) ConsumeRow(row map[string]interface{}) error {
	if err := c.contextError(); err != nil {
		return err
	}
	c.currentRow++
	if len(c.batch) == 0 {
		c.batchStartRow = c.currentRow
	}
	c.batch = append(c.batch, cloneImportRow(row))
	if len(c.batch) >= c.batchSize {
		return c.flush()
	}
	return nil
}

func (c *importBatchConsumer) Flush() error {
	return c.flush()
}

func (c *importBatchConsumer) Result() importExecutionResult {
	return importExecutionResult{
		Success:   c.successCount,
		Failed:    len(c.errorLogs),
		Total:     c.currentRow,
		ErrorLogs: append([]string(nil), c.errorLogs...),
	}
}

func (c *importBatchConsumer) flush() error {
	if err := c.contextError(); err != nil {
		return err
	}
	if len(c.batch) == 0 {
		return nil
	}
	rows := c.batch
	startRow := c.batchStartRow
	c.batch = nil
	c.batchStartRow = 0

	if c.writer != nil && c.writer.BatchEnabled() {
		batchErr := c.writer.ApplyBatch(rows)
		if batchErr == nil {
			c.successCount += len(rows)
			c.emitProgress(startRow + len(rows) - 1)
			return c.contextError()
		}
		if errors.Is(batchErr, context.Canceled) {
			return batchErr
		}
		if err := c.contextError(); err != nil {
			return err
		}
	}

	for idx, row := range rows {
		if err := c.contextError(); err != nil {
			return err
		}
		if c.writer != nil {
			if err := c.writer.ApplyOne(row); err != nil {
				if errors.Is(err, context.Canceled) {
					return err
				}
				if contextErr := c.contextError(); contextErr != nil {
					return contextErr
				}
				c.errorLogs = append(c.errorLogs, fmt.Sprintf("Row %d: %s", startRow+idx, err.Error()))
			} else {
				c.successCount++
			}
		}
		c.emitProgress(startRow + idx)
		if err := c.contextError(); err != nil {
			return err
		}
	}
	return nil
}

func (c *importBatchConsumer) emitProgress(current int) {
	if c.report == nil {
		return
	}
	c.report(importProgressState{
		JobID:          c.jobID,
		Current:        current,
		Total:          c.totalRows,
		Success:        c.successCount,
		Errors:         len(c.errorLogs),
		TotalRowsKnown: c.totalRowsKnown,
	})
}

func buildImportPreview(filePath string, previewLimit int) (importPreviewData, error) {
	collector := newImportPreviewCollector(previewLimit)
	if err := streamImportFile(filePath, collector); err != nil {
		return importPreviewData{}, err
	}
	return collector.Result(), nil
}

func parseImportFile(filePath string) ([]map[string]interface{}, []string, error) {
	collector := &importCollectConsumer{}
	if err := streamImportFile(filePath, collector); err != nil {
		return nil, nil, err
	}
	return collector.rows, collector.columns, nil
}

func streamImportFile(filePath string, consumer importFileConsumer) error {
	lower := strings.ToLower(filePath)
	switch {
	case strings.HasSuffix(lower, ".json"):
		return streamJSONImportFile(filePath, consumer)
	case strings.HasSuffix(lower, ".csv"):
		return streamCSVImportFile(filePath, consumer)
	case strings.HasSuffix(lower, ".xlsx"):
		return streamXLSXImportFile(filePath, consumer)
	case strings.HasSuffix(lower, ".xls"):
		return streamLegacyExcelImportFile(filePath, consumer)
	default:
		return fmt.Errorf("Unsupported file format")
	}
}

func streamJSONImportFile(filePath string, consumer importFileConsumer) error {
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()

	decoder := json.NewDecoder(bufio.NewReader(f))
	token, err := decoder.Token()
	if err != nil {
		return fmt.Errorf("JSON Parse Error: %w", err)
	}
	delim, ok := token.(json.Delim)
	if !ok || delim != '[' {
		return fmt.Errorf("JSON Parse Error: root array expected")
	}

	var columns []string
	for decoder.More() {
		var raw map[string]interface{}
		if err := decoder.Decode(&raw); err != nil {
			return fmt.Errorf("JSON Parse Error: %w", err)
		}
		if columns == nil {
			columns = importJSONColumns(raw)
			if err := consumer.SetColumns(columns); err != nil {
				return err
			}
		}
		if err := consumer.ConsumeRow(normalizeImportMapRow(columns, raw)); err != nil {
			return err
		}
	}
	if _, err := decoder.Token(); err != nil {
		return fmt.Errorf("JSON Parse Error: %w", err)
	}
	return nil
}

func streamCSVImportFile(filePath string, consumer importFileConsumer) error {
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()

	reader := csv.NewReader(bufio.NewReader(f))
	reader.ReuseRecord = true

	header, err := reader.Read()
	if err != nil {
		if err == io.EOF {
			return fmt.Errorf("CSV empty or missing header")
		}
		return fmt.Errorf("CSV Parse Error: %w", err)
	}
	columns := cloneImportColumns(header)
	if !hasImportUsableColumns(columns) {
		return fmt.Errorf("CSV empty or missing header")
	}
	if err := consumer.SetColumns(columns); err != nil {
		return err
	}

	for {
		record, err := reader.Read()
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("CSV Parse Error: %w", err)
		}
		if err := consumer.ConsumeRow(buildImportRowFromValues(columns, record)); err != nil {
			return err
		}
	}
}

func buildImportInsertQuery(dbType, tableName string, columns []string, row map[string]interface{}, columnTypes importColumnTypeLookup) (string, error) {
	quotedCols := make([]string, 0, len(columns))
	values := make([]string, 0, len(columns))
	for _, column := range columns {
		if strings.TrimSpace(column) == "" {
			continue
		}
		quotedCols = append(quotedCols, quoteIdentByType(dbType, column))
		colType := columnTypes.Resolve(column)
		values = append(values, formatImportSQLValue(dbType, colType, row[column]))
	}
	if len(quotedCols) == 0 {
		return "", fmt.Errorf("导入文件缺少有效列头")
	}
	return fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
		quoteQualifiedIdentByType(dbType, tableName),
		strings.Join(quotedCols, ", "),
		strings.Join(values, ", ")), nil
}

func importJSONColumns(row map[string]interface{}) []string {
	columns := make([]string, 0, len(row))
	for key := range row {
		if strings.TrimSpace(key) == "" {
			continue
		}
		columns = append(columns, key)
	}
	sort.Strings(columns)
	return columns
}

func cloneImportColumns(raw []string) []string {
	return append([]string(nil), raw...)
}

func hasImportUsableColumns(columns []string) bool {
	for _, column := range columns {
		if strings.TrimSpace(column) != "" {
			return true
		}
	}
	return false
}

func buildImportRowFromValues(columns []string, values []string) map[string]interface{} {
	row := make(map[string]interface{}, len(columns))
	for idx, column := range columns {
		if strings.TrimSpace(column) == "" {
			continue
		}
		if idx >= len(values) {
			row[column] = nil
			continue
		}
		if values[idx] == "NULL" {
			row[column] = nil
			continue
		}
		row[column] = values[idx]
	}
	return row
}

func normalizeImportMapRow(columns []string, raw map[string]interface{}) map[string]interface{} {
	row := make(map[string]interface{}, len(columns))
	for _, column := range columns {
		if value, ok := raw[column]; ok {
			row[column] = value
			continue
		}
		row[column] = nil
	}
	return row
}

func cloneImportRow(row map[string]interface{}) map[string]interface{} {
	if row == nil {
		return nil
	}
	cloned := make(map[string]interface{}, len(row))
	for key, value := range row {
		cloned[key] = value
	}
	return cloned
}

func cloneImportRows(rows []map[string]interface{}) []map[string]interface{} {
	if len(rows) == 0 {
		return nil
	}
	cloned := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		cloned = append(cloned, cloneImportRow(row))
	}
	return cloned
}
