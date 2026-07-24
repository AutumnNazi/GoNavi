package app

import (
	"errors"
	"strings"
)

const (
	maxXLSXRowsPerSheet     = 1048575
	defaultXLSXRowsPerSheet = maxXLSXRowsPerSheet
)

type ExportFileOptions struct {
	Format                         string            `json:"format"`
	Columns                        []string          `json:"columns,omitempty"`
	XLSXMaxRowsPerSheet            int               `json:"xlsxMaxRowsPerSheet,omitempty"`
	JobID                          string            `json:"jobId,omitempty"`
	TotalRowsHint                  int64             `json:"totalRowsHint,omitempty"`
	TotalRowsKnown                 bool              `json:"totalRowsKnown,omitempty"`
	IncludeDropIfExists            bool              `json:"includeDropIfExists,omitempty"`
	IncludeDatabaseContext         bool              `json:"includeDatabaseContext,omitempty"`
	InsertSQLDialect               string            `json:"insertSQLDialect,omitempty"`
	InsertSQLTargetTable           string            `json:"insertSQLTargetTable,omitempty"`
	InsertSQLColumnTypes           map[string]string `json:"insertSQLColumnTypes,omitempty"`
	InsertSQLTargetColumns         map[string]string `json:"insertSQLTargetColumns,omitempty"`
	InsertSQLAllowEmptyTargetTable bool              `json:"insertSQLAllowEmptyTargetTable,omitempty"`
}

func normalizeExportFileOptions(format string, options ExportFileOptions) ExportFileOptions {
	resolvedFormat := strings.ToLower(strings.TrimSpace(format))
	if explicitFormat := strings.ToLower(strings.TrimSpace(options.Format)); explicitFormat != "" {
		resolvedFormat = explicitFormat
	}
	return ExportFileOptions{
		Format:                         resolvedFormat,
		Columns:                        normalizeExportColumns(options.Columns),
		XLSXMaxRowsPerSheet:            normalizeXLSXRowsPerSheet(options.XLSXMaxRowsPerSheet),
		JobID:                          strings.TrimSpace(options.JobID),
		TotalRowsHint:                  normalizeExportTotalRowsHint(options.TotalRowsHint, options.TotalRowsKnown),
		TotalRowsKnown:                 options.TotalRowsKnown,
		IncludeDropIfExists:            options.IncludeDropIfExists,
		IncludeDatabaseContext:         options.IncludeDatabaseContext,
		InsertSQLDialect:               strings.ToLower(strings.TrimSpace(options.InsertSQLDialect)),
		InsertSQLTargetTable:           strings.TrimSpace(options.InsertSQLTargetTable),
		InsertSQLColumnTypes:           options.InsertSQLColumnTypes,
		InsertSQLTargetColumns:         options.InsertSQLTargetColumns,
		InsertSQLAllowEmptyTargetTable: options.InsertSQLAllowEmptyTargetTable,
	}
}

func normalizeExportColumns(columns []string) []string {
	if columns == nil {
		return nil
	}
	result := make([]string, 0, len(columns))
	seen := make(map[string]struct{}, len(columns))
	for _, column := range columns {
		if strings.TrimSpace(column) == "" {
			continue
		}
		if _, exists := seen[column]; exists {
			continue
		}
		seen[column] = struct{}{}
		result = append(result, column)
	}
	return result
}

func validateExportColumnsSelection(options ExportFileOptions) error {
	if options.Columns != nil && len(options.Columns) == 0 {
		return errors.New("at least one export column must be selected")
	}
	return nil
}

func normalizeXLSXRowsPerSheet(value int) int {
	if value <= 0 {
		return defaultXLSXRowsPerSheet
	}
	if value > maxXLSXRowsPerSheet {
		return maxXLSXRowsPerSheet
	}
	return value
}

func normalizeExportTotalRowsHint(value int64, known bool) int64 {
	if !known {
		return 0
	}
	if value < 0 {
		return 0
	}
	return value
}
