package dataexport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"

	"github.com/apache/arrow-go/v18/parquet"
	"github.com/apache/arrow-go/v18/parquet/compress"
	"github.com/apache/arrow-go/v18/parquet/file"
	"github.com/apache/arrow-go/v18/parquet/schema"
)

// parquetOutput retains the first error while letting Arrow finish resource cleanup.
// Arrow panics on magic-header write errors and drops certain footer write errors.
// This adapter also deliberately hides output.Close: the caller owns the target.
type parquetOutput struct {
	ctx    context.Context
	writer io.Writer
	err    error
}

func (w *parquetOutput) Write(payload []byte) (int, error) {
	if w.err == nil {
		w.err = w.ctx.Err()
	}
	if w.err == nil {
		n, err := w.writer.Write(payload)
		if err == nil && n != len(payload) {
			err = io.ErrShortWrite
		}
		w.err = err
	}
	return len(payload), nil
}

func (w *Parquet) parquetSchema() (*schema.GroupNode, error) {
	fields := make(schema.FieldList, len(w.columns))
	for i, name := range w.columns {
		typ := parquet.Types.ByteArray
		switch w.kinds[i] {
		case boolValue:
			typ = parquet.Types.Boolean
		case intValue:
			typ = parquet.Types.Int64
		case floatValue:
			typ = parquet.Types.Double
		}
		var err error
		if typ == parquet.Types.ByteArray {
			fields[i], err = schema.NewPrimitiveNodeLogical(name, parquet.Repetitions.Optional, schema.StringLogicalType{}, typ, -1, -1)
		} else {
			fields[i], err = schema.NewPrimitiveNode(name, parquet.Repetitions.Optional, typ, -1, -1)
		}
		if err != nil {
			return nil, fmt.Errorf("build parquet field: %w", err)
		}
	}
	return schema.NewGroupNode("query_result", parquet.Repetitions.Required, fields, -1)
}

func (w *Parquet) writeFile() error {
	root, err := w.parquetSchema()
	if err != nil {
		return err
	}
	if _, err := w.spool.Reader.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("rewind parquet spool: %w", err)
	}
	output := &parquetOutput{ctx: w.ctx, writer: w.output}
	props := parquet.NewWriterProperties(parquet.WithCompression(compress.Codecs.Snappy), parquet.WithDictionaryDefault(false))
	writer := file.NewParquetWriter(output, root, file.WithWriterProps(props))
	decoder := json.NewDecoder(w.spool.Reader)
	for output.err == nil {
		rows, readErr := w.readBatch(decoder)
		if readErr != nil {
			err = readErr
			break
		}
		if len(rows) == 0 {
			break
		}
		if err = writeParquetBatch(writer, rows, w.kinds); err != nil {
			break
		}
	}
	closeErr := writer.Close()
	return errors.Join(err, closeErr, output.err, w.ctx.Err())
}

func writeParquetBatch(writer *file.Writer, rows [][]spoolCell, kinds []valueKind) error {
	group := writer.AppendRowGroup()
	var writeErr error
	for column, kind := range kinds {
		chunk, err := group.NextColumn()
		if err != nil {
			writeErr = err
			break
		}
		if err := writeParquetColumn(chunk, rows, column, kind); err != nil {
			writeErr = err
			break
		}
	}
	return errors.Join(writeErr, group.Close())
}

func writeParquetColumn(chunk file.ColumnChunkWriter, rows [][]spoolCell, column int, kind valueKind) error {
	levels := make([]int16, len(rows))
	var bools []bool
	var ints []int64
	var floats []float64
	var texts []parquet.ByteArray
	for i, row := range rows {
		cell := row[column]
		if cell.Kind == nullValue {
			continue
		}
		levels[i] = 1
		switch kind {
		case boolValue:
			value, err := strconv.ParseBool(cell.Text)
			if err != nil {
				return err
			}
			bools = append(bools, value)
		case intValue:
			value, err := strconv.ParseInt(cell.Text, 10, 64)
			if err != nil {
				return err
			}
			ints = append(ints, value)
		case floatValue:
			value, err := strconv.ParseFloat(cell.Text, 64)
			if err != nil {
				return err
			}
			floats = append(floats, value)
		default:
			texts = append(texts, parquet.ByteArray(cell.Text))
		}
	}
	var err error
	switch writer := chunk.(type) {
	case *file.BooleanColumnChunkWriter:
		_, err = writer.WriteBatch(bools, levels, nil)
	case *file.Int64ColumnChunkWriter:
		_, err = writer.WriteBatch(ints, levels, nil)
	case *file.Float64ColumnChunkWriter:
		_, err = writer.WriteBatch(floats, levels, nil)
	case *file.ByteArrayColumnChunkWriter:
		_, err = writer.WriteBatch(texts, levels, nil)
	default:
		err = fmt.Errorf("unsupported parquet column writer %T", chunk)
	}
	return errors.Join(err, chunk.Close())
}
