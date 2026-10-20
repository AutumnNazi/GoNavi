package dataexport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
)

const (
	maxParquetRowBytes = 16 << 20
	parquetBatchBytes  = 4 << 20
	parquetBatchRows   = 1024
)

// TempFile provides private scratch storage with optional external quota accounting.
type TempFile struct {
	Reader  io.ReadSeeker
	Writer  io.Writer
	Cleanup func() error
}

// TempFactory creates a seekable spool. Cleanup must close, remove and release quota.
type TempFactory func() (*TempFile, error)

// Parquet spools each row once, determines the schema over the complete stream,
// then replays bounded row groups. Its context is scoped to a single export request.
type Parquet struct {
	ctx     context.Context
	output  io.Writer
	factory TempFactory
	spool   *TempFile
	columns []string
	kinds   []valueKind
	closed  bool
	err     error
}

// NewParquet creates a cancellable writer without taking ownership of output.
func NewParquet(ctx context.Context, output io.Writer, factory TempFactory) *Parquet {
	if factory == nil {
		factory = newParquetTempFile
	}
	return &Parquet{ctx: ctx, output: output, factory: factory}
}

func newParquetTempFile() (*TempFile, error) {
	return newParquetTempFileWithLimit(maxParquetSpoolBytes)
}

func newParquetTempFileWithLimit(limit int64) (*TempFile, error) {
	f, err := os.CreateTemp("", "gonavi-export-parquet-*")
	if err != nil {
		return nil, fmt.Errorf("create parquet spool: %w", err)
	}
	return &TempFile{Reader: f, Writer: &spoolLimitWriter{writer: f, remaining: limit}, Cleanup: func() error {
		return errors.Join(f.Close(), os.Remove(f.Name()))
	}}, nil
}

// SetColumns fixes column order before consuming any rows.
func (w *Parquet) SetColumns(columns []string) error {
	if err := w.ctx.Err(); err != nil {
		return err
	}
	if w.spool != nil || w.closed {
		return errors.New("parquet columns already initialized or writer closed")
	}
	if len(columns) > 16384 {
		return errors.New("parquet column count exceeds 16384 column safety limit")
	}
	spool, err := w.factory()
	if err != nil {
		return err
	}
	w.spool = spool
	w.columns = append([]string(nil), columns...)
	w.kinds = make([]valueKind, len(columns))
	return nil
}

// ConsumeRow accepts a selected row without retaining the caller's map.
func (w *Parquet) ConsumeRow(row map[string]interface{}) error {
	values := make([]interface{}, len(w.columns))
	for i, column := range w.columns {
		values[i] = row[column]
	}
	return w.ConsumeRowValues(values)
}

// ConsumeRowValues serializes a single row and merges its types into the schema.
func (w *Parquet) ConsumeRowValues(values []interface{}) error {
	if err := w.ctx.Err(); err != nil {
		return err
	}
	if w.spool == nil || w.closed {
		return errors.New("parquet columns not initialized or writer closed")
	}
	if w.err != nil {
		return w.err
	}
	if len(w.columns) == 0 {
		w.err = errors.New("parquet rows require at least one column")
		return w.err
	}
	cells := make([]spoolCell, len(w.columns))
	rowBytes := 0
	for i := range cells {
		if i < len(values) {
			cell, err := parquetCell(values[i])
			if err != nil {
				w.err = err
				return err
			}
			cells[i] = cell
		}
		rowBytes += len(cells[i].Text) + 32
		if rowBytes > maxParquetRowBytes {
			w.err = fmt.Errorf("parquet row exceeds %d byte safety limit", maxParquetRowBytes)
			return w.err
		}
		w.kinds[i] = mergeValueKind(w.kinds[i], cells[i].Kind)
	}
	if err := json.NewEncoder(w.spool.Writer).Encode(cells); err != nil {
		w.err = fmt.Errorf("write parquet spool: %w", err)
		return w.err
	}
	return nil
}

// Abort releases temporary storage without finalizing an incomplete export.
func (w *Parquet) Abort() error {
	w.closed = true
	if w.spool == nil {
		return nil
	}
	spool := w.spool
	w.spool = nil
	return spool.Cleanup()
}

// Close writes the final schema and bounded row groups, then removes scratch data.
func (w *Parquet) Close() error {
	if w.closed {
		return nil
	}
	err := w.err
	if err == nil {
		err = w.ctx.Err()
	}
	if err == nil && w.spool == nil {
		err = w.SetColumns(nil)
	}
	if err == nil {
		err = w.writeFile()
	}
	return errors.Join(err, w.Abort())
}

func (w *Parquet) readBatch(decoder *json.Decoder) ([][]spoolCell, error) {
	rows := make([][]spoolCell, 0, parquetBatchRows)
	bytes := 0
	for len(rows) < parquetBatchRows && bytes < parquetBatchBytes {
		if err := w.ctx.Err(); err != nil {
			return nil, err
		}
		var row []spoolCell
		if err := decoder.Decode(&row); err != nil {
			if errors.Is(err, io.EOF) {
				return rows, nil
			}
			return nil, fmt.Errorf("read parquet spool: %w", err)
		}
		for _, cell := range row {
			bytes += len(cell.Text) + 32
		}
		rows = append(rows, row)
	}
	return rows, nil
}
