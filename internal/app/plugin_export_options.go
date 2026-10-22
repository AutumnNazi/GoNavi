package app

import (
	"errors"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/plugin"
)

func isPluginExportRequest(options ExportFileOptions) bool {
	return options.PluginExporter != nil || plugin.IsExporterNamespace(options.Format)
}

func validatePluginExportOptions(options ExportFileOptions) error {
	if _, _, ok := plugin.ParseExporterType(options.Format); !ok || options.PluginExporter == nil {
		return errors.New("invalid plugin exporter selection")
	}
	pin := options.PluginExporter
	if pin.Generation == 0 || pin.Generation > 1<<53-1 || len(pin.Digest) != 64 || strings.Trim(pin.Digest, "0123456789abcdef") != "" {
		return errors.New("invalid plugin exporter selection")
	}
	if options.CSVEncoding != "" || options.XLSXMaxRowsPerSheet != 0 || len(options.ColumnComments) != 0 || options.IncludeDropIfExists || options.IncludeDatabaseContext || options.InsertSQLDialect != "" || options.InsertSQLTargetTable != "" || len(options.InsertSQLColumnTypes) != 0 || len(options.InsertSQLTargetColumns) != 0 || options.InsertSQLAllowEmptyTargetTable {
		return errors.New("unsupported plugin exporter options")
	}
	return nil
}

func (a *App) pluginExportFailure(code string) connection.QueryResult {
	return connection.QueryResult{Success: false, Message: a.appText("plugin_export.error."+code, nil), Data: map[string]any{"code": code}}
}
