package dataexport

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"
)

// PreparePluginExportSnapshot freezes only selected materialized values; it never queries or writes.
func PreparePluginExportSnapshot(ctx context.Context, data []map[string]any, columns, selected []string) (PluginExportSnapshot, error) {
	var empty PluginExportSnapshot
	if ctx == nil {
		return empty, ErrPluginExportSnapshot
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	chosen, err := pluginExportColumns(columns, selected)
	if err != nil {
		return empty, err
	}
	if len(data) > 4096 || len(data) > 16384/len(chosen) {
		return empty, ErrPluginExportSnapshot
	}
	budget := pluginExportBudget{ctx: ctx, nodes: 5 + len(chosen) + len(data)}
	snapshot := PluginExportSnapshot{Columns: chosen, Rows: make([][]PluginExportCell, 0, len(data))}
	for _, name := range chosen {
		if err = budget.addText(name); err != nil {
			return empty, err
		}
	}
	for _, source := range data {
		if err = ctx.Err(); err != nil {
			return empty, err
		}
		row := make([]PluginExportCell, len(chosen))
		for i, name := range chosen {
			value, exists := source[name]
			row[i], err = pluginExportCell(value, exists, &budget)
			if err != nil {
				return empty, err
			}
		}
		snapshot.Rows = append(snapshot.Rows, row)
	}
	raw, err := json.Marshal(snapshot)
	if err != nil || len(raw) > pluginExportMaxBytes {
		return empty, ErrPluginExportSnapshot
	}
	if err = ctx.Err(); err != nil {
		return empty, err
	}
	return snapshot, nil
}

func pluginExportColumns(columns, selected []string) ([]string, error) {
	if len(columns) == 0 || len(columns) > 4096 {
		return nil, ErrPluginExportSnapshot
	}
	source := make(map[string]bool, len(columns))
	for _, name := range columns {
		if !pluginExportColumn(name) || source[name] {
			return nil, ErrPluginExportSnapshot
		}
		source[name] = true
	}
	if selected == nil {
		selected = columns
	}
	if len(selected) == 0 || len(selected) > 256 {
		return nil, ErrPluginExportSnapshot
	}
	seen := make(map[string]bool, len(selected))
	result := make([]string, 0, len(selected))
	for _, name := range selected {
		if !source[name] || seen[name] {
			return nil, ErrPluginExportSnapshot
		}
		seen[name] = true
		result = append(result, name)
	}
	return result, nil
}
func pluginExportColumn(name string) bool {
	return len(name) <= 1024 && utf8.ValidString(name) && strings.TrimSpace(name) != "" && !strings.ContainsRune(name, 0)
}

type pluginExportBudget struct {
	ctx                     context.Context
	nodes, bytes, textLimit int
}

func (b *pluginExportBudget) addNodes(count, depth int) error {
	if err := b.ctx.Err(); err != nil {
		return err
	}
	b.nodes += count
	if b.nodes > pluginExportMaxNodes || depth > pluginExportMaxDepth {
		return ErrPluginExportSnapshot
	}
	return nil
}
func (b *pluginExportBudget) addText(value string) error {
	limit := b.textLimit
	if limit == 0 {
		limit = pluginExportCellBytes
	}
	if len(value) > limit || !utf8.ValidString(value) {
		return ErrPluginExportSnapshot
	}
	b.bytes += len(value)
	if b.bytes > pluginExportMaxBytes {
		return ErrPluginExportSnapshot
	}
	return nil
}
