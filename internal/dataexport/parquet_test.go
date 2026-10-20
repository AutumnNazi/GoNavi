package dataexport

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/apache/arrow-go/v18/parquet"
	"github.com/apache/arrow-go/v18/parquet/file"
)

func readParquetColumn(t *testing.T, reader *file.Reader, column int) []any {
	t.Helper()
	var result []any
	for groupIndex := 0; groupIndex < reader.NumRowGroups(); groupIndex++ {
		group := reader.RowGroup(groupIndex)
		chunk, err := group.Column(column)
		if err != nil {
			t.Fatal(err)
		}
		count := int(group.NumRows())
		levels := make([]int16, count)
		var values []any
		var total int64
		switch c := chunk.(type) {
		case *file.ByteArrayColumnChunkReader:
			buffer := make([]parquet.ByteArray, count)
			var n int
			total, n, err = c.ReadBatch(int64(count), buffer, levels, nil)
			for _, value := range buffer[:n] {
				values = append(values, string(value))
			}
		case *file.Int64ColumnChunkReader:
			buffer := make([]int64, count)
			var n int
			total, n, err = c.ReadBatch(int64(count), buffer, levels, nil)
			for _, value := range buffer[:n] {
				values = append(values, value)
			}
		case *file.Float64ColumnChunkReader:
			buffer := make([]float64, count)
			var n int
			total, n, err = c.ReadBatch(int64(count), buffer, levels, nil)
			for _, value := range buffer[:n] {
				values = append(values, value)
			}
		case *file.BooleanColumnChunkReader:
			buffer := make([]bool, count)
			var n int
			total, n, err = c.ReadBatch(int64(count), buffer, levels, nil)
			for _, value := range buffer[:n] {
				values = append(values, value)
			}
		default:
			t.Fatalf("unsupported reader %T", chunk)
		}
		if err != nil || total != int64(count) {
			t.Fatalf("read %d/%d: %v", total, count, err)
		}
		index := 0
		for _, level := range levels {
			if level == 0 {
				result = append(result, nil)
			} else {
				result = append(result, values[index])
				index++
			}
		}
	}
	return result
}

func parquetReader(t *testing.T, columns []string, rows [][]any) *file.Reader {
	t.Helper()
	var output bytes.Buffer
	writer := NewParquet(context.Background(), &output, nil)
	if err := writer.SetColumns(columns); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if err := writer.ConsumeRowValues(row); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	reader, err := file.NewParquetReader(bytes.NewReader(output.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := reader.Close(); err != nil {
			t.Error(err)
		}
	})
	return reader
}

func TestParquetSchemaAndValues(t *testing.T) {
	stamp := time.Date(2026, 10, 15, 1, 2, 3, 456, time.FixedZone("offset", 9*3600))
	columns := []string{"int", "float", "bool", "text", "null", "mixed", "complex", "time", "large", "decimal", "bytes"}
	reader := parquetReader(t, columns, [][]any{
		{int64(math.MaxInt64), 1.25, true, "中文", nil, int64(9007199254740993), map[string]any{"z": 2, "a": "中"}, stamp, uint64(math.MaxUint64), json.Number("1.234567890123456789"), []byte(nil)},
		{nil, nil, false, "", nil, 1.5, []any{"中文", true}, nil, uint64(1), json.Number("1.000000000000000001"), []byte{}},
	})
	if reader.NumRows() != 2 {
		t.Fatal(reader.NumRows())
	}
	for i, name := range columns {
		if reader.MetaData().Schema.Column(i).Name() != name {
			t.Fatalf("column order %d", i)
		}
	}
	want := [][]any{
		{int64(math.MaxInt64), nil}, {1.25, nil}, {true, false}, {"中文", ""}, {nil, nil},
		{"9007199254740993", "1.5"}, {`{"a":"中","z":2}`, `["中文",true]`},
		{stamp.Format(time.RFC3339Nano), nil}, {"18446744073709551615", "1"},
		{"1.234567890123456789", "1.000000000000000001"}, {nil, ""},
	}
	for i := range columns {
		if got := readParquetColumn(t, reader, i); !reflect.DeepEqual(got, want[i]) {
			t.Fatalf("%s got %#v want %#v", columns[i], got, want[i])
		}
	}
	for i, typ := range []parquet.Type{parquet.Types.Int64, parquet.Types.Double, parquet.Types.Boolean, parquet.Types.ByteArray} {
		if reader.MetaData().Schema.Column(i).PhysicalType() != typ {
			t.Fatalf("wrong type for %s", columns[i])
		}
	}
	if got := reader.MetaData().Schema.Column(3).LogicalType().String(); got != "String" {
		t.Fatalf("string logical type %q", got)
	}
}

func TestParquetEmptyAndCrossBatchTypes(t *testing.T) {
	for _, columns := range [][]string{{"中文", "empty"}, {}} {
		reader := parquetReader(t, columns, nil)
		if reader.NumRows() != 0 || reader.MetaData().Schema.NumColumns() != len(columns) {
			t.Fatal("invalid empty result")
		}
	}
	rows := make([][]any, parquetBatchRows+1)
	for i := range rows {
		rows[i] = []any{int64(math.MaxInt64), nil}
	}
	rows[len(rows)-1] = []any{true, "late value"}
	reader := parquetReader(t, []string{"mixed", "late"}, rows)
	if reader.NumRowGroups() != 2 {
		t.Fatalf("groups %d", reader.NumRowGroups())
	}
	values := readParquetColumn(t, reader, 0)
	if values[0] != "9223372036854775807" || values[len(values)-1] != "true" {
		t.Fatalf("promoted values lost: %#v %#v", values[0], values[len(values)-1])
	}
	late := readParquetColumn(t, reader, 1)
	if late[0] != nil || late[len(late)-1] != "late value" {
		t.Fatal("late values lost")
	}
}

func TestParquetTemporaryCleanupAndCancellation(t *testing.T) {
	for _, mode := range []string{"success", "cancel", "abort", "write error", "spool error"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var path string
			failure := errors.New("output full")
			factory := func() (*TempFile, error) {
				f, err := os.CreateTemp(t.TempDir(), "private-*")
				if err != nil {
					return nil, err
				}
				path = f.Name()
				info, err := f.Stat()
				if err != nil {
					t.Fatal(err)
				}
				if info.Mode().Perm() != 0600 {
					t.Fatal("scratch file not private")
				}
				var output io.Writer = f
				if mode == "spool error" {
					output = failedOutput{failure}
				}
				return &TempFile{Reader: f, Writer: output, Cleanup: func() error { return errors.Join(f.Close(), os.Remove(path)) }}, nil
			}
			var output io.Writer = io.Discard
			if mode == "write error" {
				output = failedOutput{failure}
			}
			writer := NewParquet(ctx, output, factory)
			if err := writer.SetColumns([]string{"value"}); err != nil {
				t.Fatal(err)
			}
			consumeErr := writer.ConsumeRowValues([]any{"中文"})
			if mode == "spool error" && !errors.Is(consumeErr, failure) {
				t.Fatalf("consume: %v", consumeErr)
			}
			if mode == "cancel" {
				cancel()
			}
			var err error
			if mode == "abort" {
				err = writer.Abort()
			} else {
				err = writer.Close()
			}
			if mode == "cancel" && !errors.Is(err, context.Canceled) {
				t.Fatalf("cancel: %v", err)
			}
			if (mode == "write error" || mode == "spool error") && !errors.Is(err, failure) {
				t.Fatalf("write: %v", err)
			}
			if (mode == "success" || mode == "abort") && err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatalf("scratch remains: %v", err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestParquetRejectsOversizedRowsAndUnserializableValues(t *testing.T) {
	for _, value := range []any{strings.Repeat("x", maxParquetRowBytes+1), make(chan int)} {
		writer := NewParquet(context.Background(), io.Discard, nil)
		if err := writer.SetColumns([]string{"v"}); err != nil {
			t.Fatal(err)
		}
		if err := writer.ConsumeRowValues([]any{value}); err == nil {
			t.Fatal("expected failure")
		}
		if err := writer.Close(); err == nil {
			t.Fatal("close lost failure")
		}
	}
}

func TestParquetFloat32ExactPromotion(t *testing.T) {
	value := float32(0.1)
	reader := parquetReader(t, []string{"v"}, [][]any{{value}, {float64(value)}})
	if got := readParquetColumn(t, reader, 0); !reflect.DeepEqual(got, []any{float64(value), float64(value)}) {
		t.Fatalf("float32 precision lost: %#v", got)
	}
}

func TestParquetSpoolLimit(t *testing.T) {
	var path string
	factory := func() (*TempFile, error) {
		spool, err := newParquetTempFileWithLimit(10)
		if err == nil {
			path = spool.Reader.(*os.File).Name()
		}
		return spool, err
	}
	writer := NewParquet(context.Background(), io.Discard, factory)
	if err := writer.SetColumns([]string{"v"}); err != nil {
		t.Fatal(err)
	}
	if err := writer.ConsumeRowValues([]any{"more than ten bytes"}); !errors.Is(err, ErrParquetSpoolLimit) {
		t.Fatal(err)
	}
	if err := writer.Close(); !errors.Is(err, ErrParquetSpoolLimit) {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("spool leaked")
	}
}
