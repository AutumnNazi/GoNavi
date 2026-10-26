//go:build gonavi_full_drivers || gonavi_hive_driver

package db

import (
	"context"
	"fmt"
	"strings"
)

type hiveColumnMeta struct {
	name     string
	typeName string
	position int32
	comment  string
}

type hiveRowSink interface {
	onColumns(names []string) error
	onRow(values []any) error
}

func (t *hiveTransport) getResultSetMetadata(ctx context.Context, op hiveOperationHandle) ([]hiveColumnMeta, error) {
	var cols []hiveColumnMeta
	var status hiveStatus
	err := t.call(ctx, "GetResultSetMetadata", func(w *hiveWriter) {
		w.writeFieldBegin(thriftTypeStruct, 1)
		w.writeFieldBegin(thriftTypeStruct, 1)
		writeHiveOperationHandle(w, op)
		w.writeFieldStop()
	}, func(r *hiveReader) error {
		return readSingleStructField(r, func(r *hiveReader) error {
			for {
				ft, fid, err := r.readFieldBegin()
				if err != nil {
					return wrapHiveProtocolError(err)
				}
				if ft == thriftTypeStop {
					return nil
				}
				switch {
				case fid == 1 && ft == thriftTypeStruct:
					if status, err = readHiveStatus(r); err != nil {
						return wrapHiveProtocolError(err)
					}
				case fid == 2 && ft == thriftTypeStruct:
					if cols, err = readHiveTableSchema(r); err != nil {
						return wrapHiveProtocolError(err)
					}
				default:
					if err := r.skip(ft); err != nil {
						return wrapHiveProtocolError(err)
					}
				}
			}
		})
	})
	if err != nil {
		return nil, err
	}
	if err := status.toError(); err != nil {
		return nil, err
	}
	return cols, nil
}

func (t *hiveTransport) fetchResults(ctx context.Context, op hiveOperationHandle, orientation int32, maxRows int64) ([][]any, error) {
	var rows [][]any
	var status hiveStatus
	err := t.call(ctx, "FetchResults", func(w *hiveWriter) {
		w.writeFieldBegin(thriftTypeStruct, 1) // req
		w.writeFieldBegin(thriftTypeStruct, 1) // operationHandle
		writeHiveOperationHandle(w, op)
		w.writeFieldBegin(thriftTypeI32, 2) // orientation
		w.writeI32(orientation)
		w.writeFieldBegin(thriftTypeI64, 3) // maxRows
		w.writeI64(maxRows)
		w.writeFieldBegin(thriftTypeI16, 4) // fetchType = 0 (query output)
		w.writeI16(0)
		w.writeFieldStop()
	}, func(r *hiveReader) error {
		return readSingleStructField(r, func(r *hiveReader) error {
			for {
				ft, fid, err := r.readFieldBegin()
				if err != nil {
					return wrapHiveProtocolError(err)
				}
				if ft == thriftTypeStop {
					return nil
				}
				switch {
				case fid == 1 && ft == thriftTypeStruct:
					if status, err = readHiveStatus(r); err != nil {
						return wrapHiveProtocolError(err)
					}
				case fid == 3 && ft == thriftTypeStruct:
					if rows, err = readHiveRowSet(r); err != nil {
						return wrapHiveProtocolError(err)
					}
				default:
					if err := r.skip(ft); err != nil {
						return wrapHiveProtocolError(err)
					}
				}
			}
		})
	})
	if err != nil {
		return nil, err
	}
	if err := status.toError(); err != nil {
		return nil, err
	}
	return rows, nil
}

func readHiveTableSchema(r *hiveReader) ([]hiveColumnMeta, error) {
	var cols []hiveColumnMeta
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return nil, err
		}
		if ft == thriftTypeStop {
			return cols, nil
		}
		if fid == 1 && ft == thriftTypeList {
			et, size, err := r.readListBegin()
			if err != nil {
				return nil, err
			}
			cols = make([]hiveColumnMeta, 0, size)
			for i := 0; i < size; i++ {
				if et != thriftTypeStruct {
					if err := r.skip(et); err != nil {
						return nil, err
					}
					continue
				}
				col, err := readHiveColumnDesc(r)
				if err != nil {
					return nil, err
				}
				cols = append(cols, col)
			}
		} else if err := r.skip(ft); err != nil {
			return nil, err
		}
	}
}

func readHiveColumnDesc(r *hiveReader) (hiveColumnMeta, error) {
	var col hiveColumnMeta
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return col, err
		}
		if ft == thriftTypeStop {
			return col, nil
		}
		switch {
		case fid == 1 && ft == thriftTypeString:
			if col.name, err = r.readString(); err != nil {
				return col, err
			}
		case fid == 2 && ft == thriftTypeStruct:
			if col.typeName, err = readHiveTypeDesc(r); err != nil {
				return col, err
			}
		case fid == 3 && ft == thriftTypeI32:
			if col.position, err = r.readI32(); err != nil {
				return col, err
			}
		case fid == 4 && ft == thriftTypeString:
			if col.comment, err = r.readString(); err != nil {
				return col, err
			}
		default:
			if err := r.skip(ft); err != nil {
				return col, err
			}
		}
	}
}

func readHiveTypeDesc(r *hiveReader) (string, error) {
	var typeName string
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return "", err
		}
		if ft == thriftTypeStop {
			return typeName, nil
		}
		if fid == 1 && ft == thriftTypeList {
			et, size, err := r.readListBegin()
			if err != nil {
				return "", err
			}
			for i := 0; i < size; i++ {
				if et != thriftTypeStruct {
					if err := r.skip(et); err != nil {
						return "", err
					}
					continue
				}
				name, err := readHiveTypeEntry(r)
				if err != nil {
					return "", err
				}
				if i == 0 {
					typeName = name
				}
			}
		} else if err := r.skip(ft); err != nil {
			return "", err
		}
	}
}

func readHiveTypeEntry(r *hiveReader) (string, error) {
	var typeName string
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return "", err
		}
		if ft == thriftTypeStop {
			return typeName, nil
		}
		if fid == 1 && ft == thriftTypeStruct {
			for {
				pft, pfid, err := r.readFieldBegin()
				if err != nil {
					return "", err
				}
				if pft == thriftTypeStop {
					break
				}
				if pfid == 1 && pft == thriftTypeI32 {
					typeID, err := r.readI32()
					if err != nil {
						return "", err
					}
					typeName = hiveTypeIDName(typeID)
				} else if err := r.skip(pft); err != nil {
					return "", err
				}
			}
		} else if err := r.skip(ft); err != nil {
			return "", err
		}
	}
}

func hiveTypeIDName(id int32) string {
	switch id {
	case 0:
		return "BOOLEAN"
	case 1:
		return "TINYINT"
	case 2:
		return "SMALLINT"
	case 3:
		return "INT"
	case 4:
		return "BIGINT"
	case 5:
		return "FLOAT"
	case 6:
		return "DOUBLE"
	case 7:
		return "STRING"
	case 8:
		return "TIMESTAMP"
	case 9:
		return "BINARY"
	case 10:
		return "ARRAY"
	case 11:
		return "MAP"
	case 12:
		return "STRUCT"
	case 13:
		return "UNIONTYPE"
	case 15:
		return "DECIMAL"
	case 17:
		return "DATE"
	case 18:
		return "VARCHAR"
	case 19:
		return "CHAR"
	case 20:
		return "INTERVAL_YEAR_MONTH"
	case 21:
		return "INTERVAL_DAY_TIME"
	case 22:
		return "TIMESTAMPLOCALTZ"
	default:
		return "STRING"
	}
}

func readHiveRowSet(r *hiveReader) ([][]any, error) {
	var legacyRows [][]any
	var columns [][]any
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return nil, err
		}
		if ft == thriftTypeStop {
			break
		}
		switch {
		case fid == 2 && ft == thriftTypeList:
			et, size, err := r.readListBegin()
			if err != nil {
				return nil, err
			}
			for i := 0; i < size; i++ {
				if et == thriftTypeStruct {
					row, err := readHiveLegacyRow(r)
					if err != nil {
						return nil, err
					}
					legacyRows = append(legacyRows, row)
				} else if err := r.skip(et); err != nil {
					return nil, err
				}
			}
		case fid == 3 && ft == thriftTypeList:
			et, size, err := r.readListBegin()
			if err != nil {
				return nil, err
			}
			columns = make([][]any, 0, size)
			for i := 0; i < size; i++ {
				if et == thriftTypeStruct {
					colVals, err := readHiveColumn(r)
					if err != nil {
						return nil, err
					}
					columns = append(columns, colVals)
				} else if err := r.skip(et); err != nil {
					return nil, err
				}
			}
		default:
			if err := r.skip(ft); err != nil {
				return nil, err
			}
		}
	}
	if len(columns) > 0 {
		rowCount := len(columns[0])
		rows := make([][]any, rowCount)
		for rowIdx := 0; rowIdx < rowCount; rowIdx++ {
			row := make([]any, len(columns))
			for colIdx, col := range columns {
				if rowIdx < len(col) {
					row[colIdx] = col[rowIdx]
				}
			}
			rows[rowIdx] = row
		}
		return rows, nil
	}
	return legacyRows, nil
}

func readHiveColumn(r *hiveReader) ([]any, error) {
	var values []any
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return nil, err
		}
		if ft == thriftTypeStop {
			return values, nil
		}
		if ft != thriftTypeStruct || fid < 1 || fid > 8 {
			if err := r.skip(ft); err != nil {
				return nil, err
			}
			continue
		}
		vals, nulls, err := readHiveTypedColumn(r, fid)
		if err != nil {
			return nil, err
		}
		for i := range vals {
			if isHiveNull(nulls, i) {
				vals[i] = nil
			}
		}
		values = vals
	}
}

func readHiveTypedColumn(r *hiveReader, kind int16) ([]any, []byte, error) {
	var vals []any
	var nulls []byte
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return nil, nil, err
		}
		if ft == thriftTypeStop {
			return vals, nulls, nil
		}
		switch {
		case fid == 1 && ft == thriftTypeList:
			_, size, err := r.readListBegin()
			if err != nil {
				return nil, nil, err
			}
			vals = make([]any, size)
			for i := 0; i < size; i++ {
				val, err := readHiveColumnElement(r, kind)
				if err != nil {
					return nil, nil, err
				}
				vals[i] = val
			}
		case fid == 2 && ft == thriftTypeString:
			if nulls, err = r.readBytes(); err != nil {
				return nil, nil, err
			}
		default:
			if err := r.skip(ft); err != nil {
				return nil, nil, err
			}
		}
	}
}

func readHiveColumnElement(r *hiveReader, kind int16) (any, error) {
	switch kind {
	case 1:
		return r.readBool()
	case 2:
		b, err := r.readByte()
		return int64(int8(b)), err
	case 3:
		v, err := r.readI16()
		return int64(v), err
	case 4:
		v, err := r.readI32()
		return int64(v), err
	case 5:
		return r.readI64()
	case 6:
		return r.readDouble()
	case 7:
		return r.readString()
	case 8:
		b, err := r.readBytes()
		return string(b), err
	default:
		return nil, fmt.Errorf("unsupported Hive column kind %d", kind)
	}
}

func isHiveNull(nulls []byte, rowIdx int) bool {
	byteIdx := rowIdx / 8
	if byteIdx >= len(nulls) {
		return false
	}
	return (nulls[byteIdx] & (1 << (uint(rowIdx) % 8))) != 0
}

func readHiveLegacyRow(r *hiveReader) ([]any, error) {
	var row []any
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return nil, err
		}
		if ft == thriftTypeStop {
			return row, nil
		}
		if fid == 1 && ft == thriftTypeList {
			et, size, err := r.readListBegin()
			if err != nil {
				return nil, err
			}
			row = make([]any, 0, size)
			for i := 0; i < size; i++ {
				if et == thriftTypeStruct {
					val, err := readHiveLegacyColumnValue(r)
					if err != nil {
						return nil, err
					}
					row = append(row, val)
				} else if err := r.skip(et); err != nil {
					return nil, err
				}
			}
		} else if err := r.skip(ft); err != nil {
			return nil, err
		}
	}
}

func readHiveLegacyColumnValue(r *hiveReader) (any, error) {
	var result any
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return nil, err
		}
		if ft == thriftTypeStop {
			return result, nil
		}
		if ft != thriftTypeStruct {
			if err := r.skip(ft); err != nil {
				return nil, err
			}
			continue
		}
		for {
			vft, vfid, err := r.readFieldBegin()
			if err != nil {
				return nil, err
			}
			if vft == thriftTypeStop {
				break
			}
			if vfid == 1 {
				result, err = readHiveColumnElement(r, fid)
				if err != nil {
					return nil, err
				}
			} else if err := r.skip(vft); err != nil {
				return nil, err
			}
		}
	}
}

func uniqueHiveColumnNames(cols []hiveColumnMeta) []string {
	names := make([]string, len(cols))
	used := make(map[string]int, len(cols))
	for i, col := range cols {
		name := strings.TrimSpace(col.name)
		if name == "" {
			name = fmt.Sprintf("_c%d", i)
		}
		count := used[name]
		used[name] = count + 1
		if count > 0 {
			name = fmt.Sprintf("%s_%d", name, count+1)
		}
		names[i] = name
	}
	return names
}
