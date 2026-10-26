//go:build gonavi_full_drivers || gonavi_hive_driver

package db

import (
	"context"
	"fmt"
	"strings"
)

// HiveServer2 TCLIService 协议常量定义。
const (
	hiveProtocolV10 int32 = 9  // HIVE_CLI_SERVICE_PROTOCOL_V10 (Hive 3.x)
	hiveProtocolV11 int32 = 10 // HIVE_CLI_SERVICE_PROTOCOL_V11 (Hive 4.x)

	hiveStatusSuccess         int32 = 0
	hiveStatusSuccessWithInfo int32 = 1
	hiveStatusStillExecuting  int32 = 2
	hiveStatusError           int32 = 3
	hiveStatusInvalidHandle   int32 = 4

	hiveOpInitialized int32 = 0
	hiveOpRunning     int32 = 1
	hiveOpFinished    int32 = 2
	hiveOpCanceled    int32 = 3
	hiveOpClosed      int32 = 4
	hiveOpError       int32 = 5
	hiveOpUnknown     int32 = 6
	hiveOpPending     int32 = 7
	hiveOpTimedout    int32 = 8

	hiveFetchNext  int32 = 0
	hiveFetchFirst int32 = 4

	defaultHiveFetchBatchSize int64 = 1000
)

type hiveHandleID struct {
	guid   []byte
	secret []byte
}

type hiveOperationHandle struct {
	id               hiveHandleID
	opType           int32
	hasResultSet     bool
	modifiedRowCount float64
	hasModifiedCount bool
}

type hiveStatus struct {
	statusCode   int32
	infoMessages []string
	sqlState     string
	errorCode    int32
	errorMessage string
}

type hiveOperationStatus struct {
	status         hiveStatus
	operationState int32
	sqlState       string
	errorCode      int32
	errorMessage   string
	hasResultSet   bool
}

// hiveQueryError 表示 HiveServer2 服务端返回的 SQL 执行错误。
type hiveQueryError struct {
	sqlState  string
	errorCode int32
	message   string
}

func (e *hiveQueryError) Error() string {
	state := strings.TrimSpace(e.sqlState)
	if state == "" {
		state = "HY000"
	}
	msg := strings.TrimSpace(e.message)
	if msg == "" {
		msg = "unknown Hive error"
	}
	return localizedDatabaseRuntimeError("db.backend.error.hive_query_failed", map[string]any{
		"sqlState": state,
		"code":     e.errorCode,
		"message":  msg,
	}).Error()
}

func (s hiveStatus) toError() error {
	if s.statusCode == hiveStatusSuccess || s.statusCode == hiveStatusSuccessWithInfo || s.statusCode == hiveStatusStillExecuting {
		return nil
	}
	msg := strings.TrimSpace(s.errorMessage)
	if msg == "" && len(s.infoMessages) > 0 {
		msg = strings.TrimSpace(strings.Join(s.infoMessages, "; "))
	}
	if msg == "" {
		msg = fmt.Sprintf("Hive status code %d", s.statusCode)
	}
	return &hiveQueryError{
		sqlState:  s.sqlState,
		errorCode: s.errorCode,
		message:   msg,
	}
}

func writeHiveHandleIdentifier(w *hiveWriter, id hiveHandleID) {
	w.writeFieldBegin(thriftTypeString, 1)
	w.writeBytes(id.guid)
	w.writeFieldBegin(thriftTypeString, 2)
	w.writeBytes(id.secret)
	w.writeFieldStop()
}

func writeHiveSessionHandle(w *hiveWriter, sessionID hiveHandleID) {
	w.writeFieldBegin(thriftTypeStruct, 1)
	writeHiveHandleIdentifier(w, sessionID)
	w.writeFieldStop()
}

func writeHiveOperationHandle(w *hiveWriter, op hiveOperationHandle) {
	w.writeFieldBegin(thriftTypeStruct, 1)
	writeHiveHandleIdentifier(w, op.id)
	w.writeFieldBegin(thriftTypeI32, 2)
	w.writeI32(op.opType)
	w.writeFieldBegin(thriftTypeBool, 3)
	w.writeBool(op.hasResultSet)
	if op.hasModifiedCount {
		w.writeFieldBegin(thriftTypeDouble, 4)
		w.writeDouble(op.modifiedRowCount)
	}
	w.writeFieldStop()
}

func readHiveHandleIdentifier(r *hiveReader) (hiveHandleID, error) {
	var id hiveHandleID
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return id, err
		}
		if ft == thriftTypeStop {
			return id, nil
		}
		switch {
		case fid == 1 && ft == thriftTypeString:
			if id.guid, err = r.readBytes(); err != nil {
				return id, err
			}
		case fid == 2 && ft == thriftTypeString:
			if id.secret, err = r.readBytes(); err != nil {
				return id, err
			}
		default:
			if err := r.skip(ft); err != nil {
				return id, err
			}
		}
	}
}

func readHiveSessionHandle(r *hiveReader) (hiveHandleID, error) {
	var id hiveHandleID
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return id, err
		}
		if ft == thriftTypeStop {
			return id, nil
		}
		if fid == 1 && ft == thriftTypeStruct {
			if id, err = readHiveHandleIdentifier(r); err != nil {
				return id, err
			}
		} else if err := r.skip(ft); err != nil {
			return id, err
		}
	}
}

func readHiveOperationHandle(r *hiveReader) (hiveOperationHandle, error) {
	var op hiveOperationHandle
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return op, err
		}
		if ft == thriftTypeStop {
			return op, nil
		}
		switch {
		case fid == 1 && ft == thriftTypeStruct:
			if op.id, err = readHiveHandleIdentifier(r); err != nil {
				return op, err
			}
		case fid == 2 && ft == thriftTypeI32:
			if op.opType, err = r.readI32(); err != nil {
				return op, err
			}
		case fid == 3 && ft == thriftTypeBool:
			if op.hasResultSet, err = r.readBool(); err != nil {
				return op, err
			}
		case fid == 4 && ft == thriftTypeDouble:
			if op.modifiedRowCount, err = r.readDouble(); err != nil {
				return op, err
			}
			op.hasModifiedCount = true
		default:
			if err := r.skip(ft); err != nil {
				return op, err
			}
		}
	}
}

func readHiveStatus(r *hiveReader) (hiveStatus, error) {
	var st hiveStatus
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return st, err
		}
		if ft == thriftTypeStop {
			return st, nil
		}
		switch {
		case fid == 1 && ft == thriftTypeI32:
			if st.statusCode, err = r.readI32(); err != nil {
				return st, err
			}
		case fid == 2 && ft == thriftTypeList:
			et, size, err := r.readListBegin()
			if err != nil {
				return st, err
			}
			for i := 0; i < size; i++ {
				if et == thriftTypeString {
					s, err := r.readString()
					if err != nil {
						return st, err
					}
					st.infoMessages = append(st.infoMessages, s)
				} else if err := r.skip(et); err != nil {
					return st, err
				}
			}
		case fid == 3 && ft == thriftTypeString:
			if st.sqlState, err = r.readString(); err != nil {
				return st, err
			}
		case fid == 4 && ft == thriftTypeI32:
			if st.errorCode, err = r.readI32(); err != nil {
				return st, err
			}
		case fid == 5 && ft == thriftTypeString:
			if st.errorMessage, err = r.readString(); err != nil {
				return st, err
			}
		default:
			if err := r.skip(ft); err != nil {
				return st, err
			}
		}
	}
}

func readSingleStructField(r *hiveReader, decode func(*hiveReader) error) error {
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return wrapHiveProtocolError(err)
		}
		if ft == thriftTypeStop {
			return nil
		}
		if fid == 0 && ft == thriftTypeStruct {
			if err := decode(r); err != nil {
				return err
			}
		} else if err := r.skip(ft); err != nil {
			return wrapHiveProtocolError(err)
		}
	}
}

// openSession 调用 TCLIService.OpenSession 打开会话并协商协议版本。
func (t *hiveTransport) openSession(ctx context.Context, clientProtocol int32, username, password string, conf map[string]string) (hiveHandleID, int32, error) {
	var sessionID hiveHandleID
	var serverProtocol int32
	var status hiveStatus
	err := t.call(ctx, "OpenSession", func(w *hiveWriter) {
		w.writeFieldBegin(thriftTypeStruct, 1) // req
		w.writeFieldBegin(thriftTypeI32, 1)    // client_protocol
		w.writeI32(clientProtocol)
		if username != "" {
			w.writeFieldBegin(thriftTypeString, 2)
			w.writeString(username)
		}
		if password != "" {
			w.writeFieldBegin(thriftTypeString, 3)
			w.writeString(password)
		}
		if len(conf) > 0 {
			w.writeFieldBegin(thriftTypeMap, 4)
			w.writeStringMap(conf)
		}
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
				case fid == 2 && ft == thriftTypeI32:
					if serverProtocol, err = r.readI32(); err != nil {
						return wrapHiveProtocolError(err)
					}
				case fid == 3 && ft == thriftTypeStruct:
					if sessionID, err = readHiveSessionHandle(r); err != nil {
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
		return sessionID, 0, err
	}
	if err := status.toError(); err != nil {
		return sessionID, 0, err
	}
	return sessionID, serverProtocol, nil
}

func (t *hiveTransport) closeSession(ctx context.Context, sessionID hiveHandleID) error {
	var status hiveStatus
	err := t.call(ctx, "CloseSession", func(w *hiveWriter) {
		w.writeFieldBegin(thriftTypeStruct, 1) // req
		w.writeFieldBegin(thriftTypeStruct, 1) // sessionHandle
		writeHiveSessionHandle(w, sessionID)
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
				if fid == 1 && ft == thriftTypeStruct {
					if status, err = readHiveStatus(r); err != nil {
						return wrapHiveProtocolError(err)
					}
				} else if err := r.skip(ft); err != nil {
					return wrapHiveProtocolError(err)
				}
			}
		})
	})
	if err != nil {
		return err
	}
	return status.toError()
}

func (t *hiveTransport) executeStatement(ctx context.Context, sessionID hiveHandleID, statement string, confOverlay map[string]string, runAsync bool, queryTimeoutSec int64) (hiveOperationHandle, error) {
	var op hiveOperationHandle
	var status hiveStatus
	err := t.call(ctx, "ExecuteStatement", func(w *hiveWriter) {
		w.writeFieldBegin(thriftTypeStruct, 1) // req
		w.writeFieldBegin(thriftTypeStruct, 1) // sessionHandle
		writeHiveSessionHandle(w, sessionID)
		w.writeFieldBegin(thriftTypeString, 2) // statement
		w.writeString(statement)
		if len(confOverlay) > 0 {
			w.writeFieldBegin(thriftTypeMap, 3)
			w.writeStringMap(confOverlay)
		}
		w.writeFieldBegin(thriftTypeBool, 4) // runAsync
		w.writeBool(runAsync)
		if queryTimeoutSec > 0 {
			w.writeFieldBegin(thriftTypeI64, 5) // queryTimeout
			w.writeI64(queryTimeoutSec)
		}
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
					if op, err = readHiveOperationHandle(r); err != nil {
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
		return op, err
	}
	if err := status.toError(); err != nil {
		return op, err
	}
	return op, nil
}

func (t *hiveTransport) getOperationStatus(ctx context.Context, op hiveOperationHandle) (hiveOperationStatus, error) {
	var resp hiveOperationStatus
	err := t.call(ctx, "GetOperationStatus", func(w *hiveWriter) {
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
					if resp.status, err = readHiveStatus(r); err != nil {
						return wrapHiveProtocolError(err)
					}
				case fid == 2 && ft == thriftTypeI32:
					if resp.operationState, err = r.readI32(); err != nil {
						return wrapHiveProtocolError(err)
					}
				case fid == 3 && ft == thriftTypeString:
					if resp.sqlState, err = r.readString(); err != nil {
						return wrapHiveProtocolError(err)
					}
				case fid == 4 && ft == thriftTypeI32:
					if resp.errorCode, err = r.readI32(); err != nil {
						return wrapHiveProtocolError(err)
					}
				case fid == 5 && ft == thriftTypeString:
					if resp.errorMessage, err = r.readString(); err != nil {
						return wrapHiveProtocolError(err)
					}
				case fid == 9 && ft == thriftTypeBool:
					if resp.hasResultSet, err = r.readBool(); err != nil {
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
		return resp, err
	}
	if err := resp.status.toError(); err != nil {
		return resp, err
	}
	return resp, nil
}

func (t *hiveTransport) cancelOperation(ctx context.Context, op hiveOperationHandle) error {
	var status hiveStatus
	err := t.call(ctx, "CancelOperation", func(w *hiveWriter) {
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
				if fid == 1 && ft == thriftTypeStruct {
					if status, err = readHiveStatus(r); err != nil {
						return wrapHiveProtocolError(err)
					}
				} else if err := r.skip(ft); err != nil {
					return wrapHiveProtocolError(err)
				}
			}
		})
	})
	if err != nil {
		return err
	}
	return status.toError()
}

func (t *hiveTransport) closeOperation(ctx context.Context, op hiveOperationHandle) error {
	var status hiveStatus
	err := t.call(ctx, "CloseOperation", func(w *hiveWriter) {
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
				if fid == 1 && ft == thriftTypeStruct {
					if status, err = readHiveStatus(r); err != nil {
						return wrapHiveProtocolError(err)
					}
				} else if err := r.skip(ft); err != nil {
					return wrapHiveProtocolError(err)
				}
			}
		})
	})
	if err != nil {
		return err
	}
	return status.toError()
}
