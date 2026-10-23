package dataexport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// PluginExportChunkRows bounds each ordered streaming frame, not the document total.
const PluginExportChunkRows = 512

// PluginExportStream freezes every selected value before the host asks for a destination.
type PluginExportStream struct {
	Columns []string
	Rows    [][]PluginExportCell
}

// PluginExportChunk is one ordered slice of a larger frozen selection.
type PluginExportChunk struct {
	Columns []string
	Rows    [][]PluginExportCell
	Index   int
	Count   int
}

// PreparePluginExportColumns resolves the requested column order before any rendering work.
func PreparePluginExportColumns(columns, selected []string) ([]string, error) {
	return pluginExportColumns(columns, selected)
}

// PreparePluginExportStream freezes all selected cells without imposing document-wide row or cell caps.
// Each row stays bounded by the same per-cell and per-row budgets as a one-shot snapshot.
func PreparePluginExportStream(ctx context.Context, data []map[string]any, columns, selected []string) (PluginExportStream, error) {
	if ctx == nil {
		return PluginExportStream{}, ErrPluginExportSnapshot
	}
	chosen, err := pluginExportColumns(columns, selected)
	if err != nil {
		return PluginExportStream{}, err
	}
	rows := make([][]PluginExportCell, 0, len(data))
	for _, source := range data {
		if err := ctx.Err(); err != nil {
			return PluginExportStream{}, err
		}
		budget := pluginExportBudget{ctx: ctx, nodes: 5 + len(chosen)}
		row := make([]PluginExportCell, len(chosen))
		for i, name := range chosen {
			value, exists := source[name]
			row[i], err = pluginExportCell(value, exists, &budget)
			if err != nil {
				return PluginExportStream{}, err
			}
		}
		rows = append(rows, row)
	}
	return PluginExportStream{Columns: chosen, Rows: rows}, nil
}

// StreamPluginExport sends ordered bounded chunks and appends validated document text.
// The extension owns headers and footers through the chunk index; the host never reorders or drops rows.
func StreamPluginExport(ctx context.Context, exporter *PluginExporter, stream PluginExportStream, write func([]byte) error, progress func(int64)) (int64, error) {
	if ctx == nil || exporter == nil || write == nil || len(stream.Columns) == 0 {
		return 0, ErrPluginExportSnapshot
	}
	rows, columns := stream.Rows, stream.Columns
	count := (len(rows) + PluginExportChunkRows - 1) / PluginExportChunkRows
	if count == 0 {
		// A zero-row selection still gets one stateless frame so the plugin can
		// emit a header or an explicitly empty document.
		count = 1
	}
	if count > 1<<20 {
		return 0, ErrPluginExportSnapshot
	}
	var sent int64
	for index := 0; index < count; index++ {
		if err := ctx.Err(); err != nil {
			return sent, err
		}
		start := index * PluginExportChunkRows
		end := start + PluginExportChunkRows
		if end > len(rows) {
			end = len(rows)
		}
		text, err := exporter.RenderChunk(ctx, PluginExportChunk{Columns: columns, Rows: rows[start:end], Index: index, Count: count})
		if err != nil {
			return sent, err
		}
		if err = write([]byte(text)); err != nil {
			return sent, fmt.Errorf("write plugin export chunk: %w", err)
		}
		sent += int64(end - start)
		if progress != nil {
			progress(sent)
		}
	}
	return sent, nil
}

func pluginExportChunkRows(ctx context.Context, columns []string, data []map[string]any) ([][]PluginExportCell, error) {
	if len(columns) == 0 || len(data) > PluginExportChunkRows {
		return nil, ErrPluginExportSnapshot
	}
	budget := pluginExportBudget{ctx: ctx, nodes: 5 + len(columns) + len(data)*len(columns)}
	for _, name := range columns {
		if err := budget.addText(name); err != nil {
			return nil, err
		}
	}
	rows := make([][]PluginExportCell, 0, len(data))
	for _, source := range data {
		row := make([]PluginExportCell, len(columns))
		var err error
		for i, name := range columns {
			value, exists := source[name]
			row[i], err = pluginExportCell(value, exists, &budget)
			if err != nil {
				return nil, err
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
}

type pluginExportChunkRequest struct {
	ProtocolVersion int                  `json:"protocolVersion"`
	ExporterID      string               `json:"exporterId"`
	Columns         []string             `json:"columns"`
	ChunkIndex      int                  `json:"chunkIndex"`
	ChunkCount      int                  `json:"chunkCount"`
	Rows            [][]PluginExportCell `json:"rows"`
}

// RenderChunk renders one ordered slice; every frame is independently bounded and re-authorised.
func (e *PluginExporter) RenderChunk(ctx context.Context, chunk PluginExportChunk) (string, error) {
	if e == nil || chunk.Count < 1 || chunk.Index < 0 || chunk.Index >= chunk.Count || len(chunk.Rows) > PluginExportChunkRows {
		return "", ErrPluginExportSnapshot
	}
	if err := e.Check(ctx); err != nil {
		return "", err
	}
	request, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	frozen, err := pluginExportChunkCopy(request, chunk)
	if err != nil {
		return "", err
	}
	args, err := json.Marshal(pluginExportChunkRequest{ProtocolVersion: 2, ExporterID: e.descriptor.ID, Columns: frozen.Columns, ChunkIndex: chunk.Index, ChunkCount: chunk.Count, Rows: frozen.Rows})
	if err != nil {
		return "", ErrPluginExportSnapshot
	}
	budget := pluginExportBudget{ctx: request}
	if err = pluginExportCheckJSON(args, pluginExportMaxBytes, &budget, 0); err != nil {
		return "", err
	}
	if err = e.Check(request); err != nil {
		return "", err
	}
	reply, err := e.invoke(request, args)
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if err != nil {
		return "", ErrPluginExportRender
	}
	if err = e.Check(request); err != nil {
		return "", err
	}
	text, err := pluginExportChunkReply(request, reply, e.descriptor.ID, chunk.Index, len(frozen.Rows))
	if err != nil {
		return "", err
	}
	if err = e.Check(request); err != nil {
		return "", err
	}
	return text, nil
}

func pluginExportChunkCopy(ctx context.Context, chunk PluginExportChunk) (PluginExportChunk, error) {
	columns, err := pluginExportColumns(chunk.Columns, nil)
	if err != nil {
		return PluginExportChunk{}, err
	}
	copyBudget := pluginExportBudget{ctx: ctx, nodes: 5 + len(columns) + len(chunk.Rows)*len(columns)}
	result := PluginExportChunk{Columns: columns, Rows: make([][]PluginExportCell, 0, len(chunk.Rows)), Index: chunk.Index, Count: chunk.Count}
	for _, name := range columns {
		if err = copyBudget.addText(name); err != nil {
			return PluginExportChunk{}, err
		}
	}
	for _, source := range chunk.Rows {
		if len(source) != len(columns) {
			return PluginExportChunk{}, ErrPluginExportSnapshot
		}
		row := make([]PluginExportCell, len(source))
		for i, cell := range source {
			row[i], err = pluginExportCellCopy(cell, &copyBudget)
			if err != nil {
				return PluginExportChunk{}, err
			}
		}
		result.Rows = append(result.Rows, row)
	}
	return result, nil
}

func pluginExportChunkReply(ctx context.Context, raw []byte, exporterID string, index, rows int) (string, error) {
	budget := pluginExportBudget{ctx: ctx, textLimit: pluginExportMaxBytes}
	if pluginExportCheckJSON(raw, pluginExportMaxBytes, &budget, 0) != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", ErrPluginExportRender
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || len(fields) != 5 {
		return "", ErrPluginExportRender
	}
	for _, key := range []string{"protocolVersion", "exporterId", "chunkIndex", "rowCount", "text"} {
		value, ok := fields[key]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return "", ErrPluginExportRender
		}
	}
	var result struct {
		ProtocolVersion int    `json:"protocolVersion"`
		ExporterID      string `json:"exporterId"`
		ChunkIndex      int    `json:"chunkIndex"`
		RowCount        int    `json:"rowCount"`
		Text            string `json:"text"`
	}
	if json.Unmarshal(raw, &result) != nil || result.ProtocolVersion != 2 || result.ExporterID != exporterID || result.ChunkIndex != index || result.RowCount != rows || !utf8.ValidString(result.Text) || len(result.Text) > pluginExportMaxBytes || strings.ContainsRune(result.Text, 0) {
		return "", ErrPluginExportRender
	}
	return result.Text, nil
}
