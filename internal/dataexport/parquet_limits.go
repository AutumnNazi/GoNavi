package dataexport

import (
	"errors"
	"fmt"
	"io"
	"reflect"
	"unicode/utf8"
)

const maxParquetSpoolBytes int64 = 4 << 30

// ErrParquetSpoolLimit identifies the per-export temporary storage safety limit.
var ErrParquetSpoolLimit = errors.New("parquet temporary storage limit exceeded")

type spoolLimitWriter struct {
	writer    io.Writer
	remaining int64
}

func (w *spoolLimitWriter) Write(payload []byte) (int, error) {
	if int64(len(payload)) > w.remaining {
		return 0, ErrParquetSpoolLimit
	}
	n, err := w.writer.Write(payload)
	w.remaining -= int64(n)
	if err == nil && n != len(payload) {
		err = io.ErrShortWrite
	}
	return n, err
}

// checkParquetValueSize bounds traversal before JSON allocates its full encoding.
// Depth also bounds cycles; complex values are rejected rather than truncated.
func checkParquetValueSize(value reflect.Value, remaining *int, depth int) error {
	if !value.IsValid() {
		return nil
	}
	if depth > 64 {
		return errors.New("parquet complex value exceeds nesting limit")
	}
	*remaining -= 32
	if *remaining < 0 {
		return fmt.Errorf("parquet value exceeds %d byte safety limit", maxParquetRowBytes)
	}
	switch value.Kind() {
	case reflect.String:
		if !utf8.ValidString(value.String()) {
			return errors.New("parquet string is not valid utf-8")
		}
		*remaining -= value.Len()
	case reflect.Interface, reflect.Pointer:
		if !value.IsNil() {
			return checkParquetValueSize(value.Elem(), remaining, depth+1)
		}
	case reflect.Slice, reflect.Array:
		if value.Type().Elem().Kind() == reflect.Uint8 {
			*remaining -= value.Len()
			break
		}
		for i := 0; i < value.Len(); i++ {
			if err := checkParquetValueSize(value.Index(i), remaining, depth+1); err != nil {
				return err
			}
		}
	case reflect.Map:
		iter := value.MapRange()
		for iter.Next() {
			if err := checkParquetValueSize(iter.Key(), remaining, depth+1); err != nil {
				return err
			}
			if err := checkParquetValueSize(iter.Value(), remaining, depth+1); err != nil {
				return err
			}
		}
	case reflect.Struct:
		for i := 0; i < value.NumField(); i++ {
			if err := checkParquetValueSize(value.Field(i), remaining, depth+1); err != nil {
				return err
			}
		}
	}
	if *remaining < 0 {
		return fmt.Errorf("parquet value exceeds %d byte safety limit", maxParquetRowBytes)
	}
	return nil
}
