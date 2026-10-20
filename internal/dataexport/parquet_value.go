package dataexport

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strconv"
	"time"
	"unicode/utf8"
)

type valueKind uint8

const (
	nullValue valueKind = iota
	boolValue
	intValue
	floatValue
	stringValue
)

// spoolCell stores lexical values so schema promotion never rounds a number.
type spoolCell struct {
	Kind valueKind `json:"k"`
	Text string    `json:"v,omitempty"`
}

func parquetCell(value any) (spoolCell, error) {
	if value == nil {
		return spoolCell{}, nil
	}
	switch v := value.(type) {
	case time.Time:
		return spoolCell{Kind: stringValue, Text: v.Format(time.RFC3339Nano)}, nil
	case json.Number:
		if n, err := v.Int64(); err == nil {
			return spoolCell{Kind: intValue, Text: strconv.FormatInt(n, 10)}, nil
		}
		return spoolCell{Kind: stringValue, Text: string(v)}, nil
	case []byte:
		if len(v) > maxParquetRowBytes {
			return spoolCell{}, fmt.Errorf("parquet byte value exceeds safety limit")
		}
		if v == nil {
			return spoolCell{}, nil
		}
		if utf8.Valid(v) {
			return spoolCell{Kind: stringValue, Text: string(v)}, nil
		}
		return spoolCell{Kind: stringValue, Text: "base64:" + base64.StdEncoding.EncodeToString(v)}, nil
	}
	v := reflect.ValueOf(value)
	switch v.Kind() {
	case reflect.Bool:
		return spoolCell{Kind: boolValue, Text: strconv.FormatBool(v.Bool())}, nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return spoolCell{Kind: intValue, Text: strconv.FormatInt(v.Int(), 10)}, nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		kind := intValue
		if v.Uint() > math.MaxInt64 {
			kind = stringValue
		}
		return spoolCell{Kind: kind, Text: strconv.FormatUint(v.Uint(), 10)}, nil
	case reflect.Float32, reflect.Float64:
		kind := floatValue
		if math.IsNaN(v.Float()) || math.IsInf(v.Float(), 0) {
			kind = stringValue
		}
		return spoolCell{Kind: kind, Text: strconv.FormatFloat(v.Float(), 'g', -1, 64)}, nil
	case reflect.String:
		if !utf8.ValidString(v.String()) {
			return spoolCell{}, fmt.Errorf("parquet string is not valid utf-8")
		}
		return spoolCell{Kind: stringValue, Text: v.String()}, nil
	case reflect.Pointer, reflect.Map, reflect.Slice, reflect.Interface:
		if v.IsNil() {
			return spoolCell{}, nil
		}
	}
	remaining := maxParquetRowBytes
	if err := checkParquetValueSize(v, &remaining, 0); err != nil {
		return spoolCell{}, err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return spoolCell{}, fmt.Errorf("serialize parquet value: %w", err)
	}
	return spoolCell{Kind: stringValue, Text: string(encoded)}, nil
}

func mergeValueKind(previous, next valueKind) valueKind {
	if next == nullValue {
		return previous
	}
	if previous == nullValue || previous == next {
		return next
	}
	// Conservative promotion keeps large integers and decimal lexemes exact.
	return stringValue
}
