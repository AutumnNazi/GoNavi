package dataexport

import (
	"context"
	"encoding/base64"
	"encoding/json"
)

func pluginExportSnapshotCopy(ctx context.Context, input PluginExportSnapshot) (PluginExportSnapshot, error) {
	var empty PluginExportSnapshot
	columns, err := pluginExportColumns(input.Columns, nil)
	if err != nil {
		return empty, err
	}
	if len(input.Rows) > 4096 || len(input.Rows) > 16384/len(columns) {
		return empty, ErrPluginExportSnapshot
	}
	budget := pluginExportBudget{ctx: ctx, nodes: 5 + len(columns) + len(input.Rows)}
	result := PluginExportSnapshot{Columns: columns, Rows: make([][]PluginExportCell, 0, len(input.Rows))}
	for _, name := range columns {
		if err = budget.addText(name); err != nil {
			return empty, err
		}
	}
	for _, source := range input.Rows {
		if err = ctx.Err(); err != nil {
			return empty, err
		}
		if len(source) != len(columns) {
			return empty, ErrPluginExportSnapshot
		}
		row := make([]PluginExportCell, len(source))
		for i, cell := range source {
			row[i], err = pluginExportCellCopy(cell, &budget)
			if err != nil {
				return empty, err
			}
		}
		result.Rows = append(result.Rows, row)
	}
	return result, nil
}
func pluginExportCellCopy(cell PluginExportCell, budget *pluginExportBudget) (PluginExportCell, error) {
	if cell.Kind == "missing" || cell.Kind == "null" {
		if cell.Value != nil {
			return PluginExportCell{}, ErrPluginExportSnapshot
		}
		return pluginExportCell(nil, cell.Kind == "null", budget)
	}
	if cell.Value == nil || len(*cell.Value) > pluginExportCellBytes {
		return PluginExportCell{}, ErrPluginExportSnapshot
	}
	value := *cell.Value
	switch cell.Kind {
	case "string":
		return pluginExportCell(value, true, budget)
	case "number":
		return pluginExportCell(json.Number(value), true, budget)
	case "boolean":
		if value != "true" && value != "false" {
			return PluginExportCell{}, ErrPluginExportSnapshot
		}
		return pluginExportCell(value == "true", true, budget)
	case "json":
		return pluginExportCell(json.RawMessage(value), true, budget)
	case "binary":
		raw, err := base64.StdEncoding.DecodeString(value)
		if err != nil || base64.StdEncoding.EncodeToString(raw) != value {
			return PluginExportCell{}, ErrPluginExportSnapshot
		}
		if raw == nil {
			raw = []byte{}
		}
		return pluginExportCell(raw, true, budget)
	}
	return PluginExportCell{}, ErrPluginExportSnapshot
}
