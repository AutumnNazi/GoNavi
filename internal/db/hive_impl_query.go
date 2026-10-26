//go:build gonavi_full_drivers || gonavi_hive_driver

package db

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const hiveCancelTimeout = 5 * time.Second

// normalizeHiveStatement 去掉语句末尾的分号：HiveServer2 Thrift ExecuteStatement 只接受单条不含尾部分号的 HQL。
func normalizeHiveStatement(query string) string {
	return strings.TrimRight(strings.TrimSpace(query), "; \t\r\n")
}

func (h *HiveDB) QueryContext(ctx context.Context, query string) ([]map[string]interface{}, []string, error) {
	h.execMu.Lock()
	defer h.execMu.Unlock()
	return h.queryStatementOnSession(ctx, query, RowBudgetFromContext(ctx))
}

func (h *HiveDB) Query(query string) ([]map[string]interface{}, []string, error) {
	return h.QueryContext(metadataContextFor(h), query)
}

func (h *HiveDB) StreamQueryContext(ctx context.Context, query string, consumer QueryStreamConsumer) error {
	h.execMu.Lock()
	defer h.execMu.Unlock()
	if h.transport == nil {
		return localizedDatabaseRuntimeError("db.backend.error.connection_not_open", nil)
	}
	sink := &hiveStreamSink{consumer: consumer}
	_, err := h.runOperation(ctx, query, sink)
	return err
}

func (h *HiveDB) StreamQuery(query string, consumer QueryStreamConsumer) error {
	return h.StreamQueryContext(metadataContextFor(h), query, consumer)
}

func (h *HiveDB) ExecContext(ctx context.Context, query string) (int64, error) {
	h.execMu.Lock()
	defer h.execMu.Unlock()
	return h.execStatementOnSession(ctx, query)
}

func (h *HiveDB) Exec(query string) (int64, error) {
	return h.ExecContext(metadataContextFor(h), query)
}

func (h *HiveDB) QueryContextWithArgs(ctx context.Context, query string, args []any) ([]map[string]interface{}, []string, error) {
	bound, err := hiveBindArgs(query, args)
	if err != nil {
		return nil, nil, err
	}
	return h.QueryContext(ctx, bound)
}

func (h *HiveDB) ExecContextWithArgs(ctx context.Context, query string, args []any) (int64, error) {
	bound, err := hiveBindArgs(query, args)
	if err != nil {
		return 0, err
	}
	return h.ExecContext(ctx, bound)
}

func (h *HiveDB) queryStatementOnSession(ctx context.Context, query string, budget *RowBudget) ([]map[string]interface{}, []string, error) {
	if h.transport == nil {
		return nil, nil, localizedDatabaseRuntimeError("db.backend.error.connection_not_open", nil)
	}
	collector := &hiveRowCollector{budget: budget}
	if _, err := h.runOperation(ctx, query, collector); err != nil {
		return nil, nil, err
	}
	if collector.data == nil {
		collector.data = make([]map[string]interface{}, 0)
	}
	return collector.data, collector.names, nil
}

func (h *HiveDB) execStatementOnSession(ctx context.Context, query string) (int64, error) {
	if h.transport == nil {
		return 0, localizedDatabaseRuntimeError("db.backend.error.connection_not_open", nil)
	}
	return h.runOperation(ctx, query, nil)
}

func (h *HiveDB) runOperation(ctx context.Context, rawQuery string, sink hiveRowSink) (int64, error) {
	statement := normalizeHiveStatement(rawQuery)
	if statement == "" {
		return 0, nil
	}
	op, err := h.transport.executeStatement(ctx, h.sessionID, statement, nil, true, 0)
	if err != nil {
		return 0, err
	}
	closed := false
	closeOp := func() {
		if closed || len(op.id.guid) == 0 {
			return
		}
		closed = true
		cctx, cancel := context.WithTimeout(context.Background(), hiveCancelTimeout)
		defer cancel()
		_ = h.transport.closeOperation(cctx, op)
	}
	defer closeOp()

	cancelOp := func() {
		if len(op.id.guid) == 0 {
			return
		}
		cctx, cancel := context.WithTimeout(context.Background(), hiveCancelTimeout)
		defer cancel()
		_ = h.transport.cancelOperation(cctx, op)
	}

	hasResultSet, err := h.waitOperationFinished(ctx, op, cancelOp)
	if err != nil {
		return 0, err
	}
	if op.hasResultSet {
		hasResultSet = true
	}

	var affected int64
	if op.hasModifiedCount && op.modifiedRowCount > 0 {
		affected = int64(op.modifiedRowCount)
	}

	if !hasResultSet || sink == nil {
		return affected, nil
	}

	cols, err := h.transport.getResultSetMetadata(ctx, op)
	if err != nil {
		if ctx.Err() != nil {
			cancelOp()
			return 0, ctx.Err()
		}
		return 0, err
	}
	names := uniqueHiveColumnNames(cols)
	if err := sink.onColumns(names); err != nil {
		return affected, err
	}

	for {
		batch, fetchErr := h.transport.fetchResults(ctx, op, hiveFetchNext, defaultHiveFetchBatchSize)
		if fetchErr != nil {
			if ctx.Err() != nil {
				cancelOp()
				return 0, ctx.Err()
			}
			return 0, fetchErr
		}
		if len(batch) == 0 {
			break
		}
		for _, row := range batch {
			if err := sink.onRow(row); err != nil {
				if errors.Is(err, errHiveStopFetch) {
					cancelOp()
					return affected, nil
				}
				cancelOp()
				return 0, err
			}
		}
	}
	return affected, nil
}

func (h *HiveDB) waitOperationFinished(ctx context.Context, op hiveOperationHandle, cancelOp func()) (bool, error) {
	pollWait := 20 * time.Millisecond
	for {
		st, err := h.transport.getOperationStatus(ctx, op)
		if err != nil {
			if ctx.Err() != nil {
				cancelOp()
				return false, ctx.Err()
			}
			return false, err
		}
		switch st.operationState {
		case hiveOpFinished:
			return st.hasResultSet, nil
		case hiveOpInitialized, hiveOpPending, hiveOpRunning:
			timer := time.NewTimer(pollWait)
			select {
			case <-ctx.Done():
				timer.Stop()
				cancelOp()
				return false, ctx.Err()
			case <-timer.C:
				if pollWait < 200*time.Millisecond {
					pollWait *= 2
				}
			}
		case hiveOpCanceled:
			return false, context.Canceled
		case hiveOpTimedout:
			return false, context.DeadlineExceeded
		case hiveOpError, hiveOpClosed, hiveOpUnknown:
			msg := strings.TrimSpace(st.errorMessage)
			if msg == "" {
				msg = fmt.Sprintf("Hive operation failed in state %d", st.operationState)
			}
			return false, &hiveQueryError{
				sqlState:  st.sqlState,
				errorCode: st.errorCode,
				message:   msg,
			}
		default:
			return st.hasResultSet, nil
		}
	}
}

var errHiveStopFetch = errors.New("stop hive fetch")

type hiveRowCollector struct {
	names  []string
	data   []map[string]interface{}
	budget *RowBudget
}

func (c *hiveRowCollector) onColumns(names []string) error {
	c.names = names
	return nil
}

func (c *hiveRowCollector) onRow(values []any) error {
	if !c.budget.CanMaterializeRow(len(c.data)) {
		return errHiveStopFetch
	}
	row := make(map[string]interface{}, len(c.names))
	for i, name := range c.names {
		if i < len(values) {
			row[name] = normalizeQueryValue(values[i])
		} else {
			row[name] = nil
		}
	}
	row, fieldTruncated := boundQueryRowFields(row, c.budget.MaxFieldBytes())
	if fieldTruncated {
		c.budget.MarkFieldTruncated()
	}
	if !c.budget.ConsumeRow(estimateQueryRowBytes(row)) {
		return errHiveStopFetch
	}
	c.data = append(c.data, row)
	return nil
}

type hiveStreamSink struct {
	consumer QueryStreamConsumer
	names    []string
}

func (s *hiveStreamSink) onColumns(names []string) error {
	s.names = names
	return s.consumer.SetColumns(names)
}

func (s *hiveStreamSink) onRow(values []any) error {
	row := make(map[string]interface{}, len(s.names))
	for i, name := range s.names {
		if i < len(values) {
			row[name] = values[i]
		} else {
			row[name] = nil
		}
	}
	return s.consumer.ConsumeRow(row)
}

// hiveBindArgs 将 SQL 中不在引号或注释内的 ? 占位符替换为 HiveQL 字面量。
func hiveBindArgs(query string, args []any) (string, error) {
	if len(args) == 0 {
		return query, nil
	}
	var out strings.Builder
	out.Grow(len(query) + len(args)*16)
	argIdx := 0
	var quote rune
	for i := 0; i < len(query); i++ {
		ch := rune(query[i])
		if quote != 0 {
			out.WriteByte(query[i])
			if ch == '\\' && i+1 < len(query) {
				i++
				out.WriteByte(query[i])
				continue
			}
			if ch == quote {
				if i+1 < len(query) && rune(query[i+1]) == quote {
					i++
					out.WriteByte(query[i])
					continue
				}
				quote = 0
			}
			continue
		}
		if ch == '\'' || ch == '"' || ch == '`' {
			quote = ch
			out.WriteByte(query[i])
			continue
		}
		if ch == '-' && i+1 < len(query) && query[i+1] == '-' {
			end := strings.IndexByte(query[i:], '\n')
			if end < 0 {
				out.WriteString(query[i:])
				break
			}
			out.WriteString(query[i : i+end+1])
			i += end
			continue
		}
		if ch == '/' && i+1 < len(query) && query[i+1] == '*' {
			end := strings.Index(query[i+2:], "*/")
			if end < 0 {
				out.WriteString(query[i:])
				break
			}
			out.WriteString(query[i : i+2+end+2])
			i += 2 + end + 1
			continue
		}
		if ch == '?' {
			if argIdx >= len(args) {
				return "", fmt.Errorf("insufficient arguments for query placeholders: got %d", len(args))
			}
			out.WriteString(hiveLiteral(args[argIdx]))
			argIdx++
			continue
		}
		out.WriteByte(query[i])
	}
	if argIdx != len(args) {
		return "", fmt.Errorf("placeholder count %d does not match argument count %d", argIdx, len(args))
	}
	return out.String(), nil
}

func hiveLiteral(value any) string {
	switch v := value.(type) {
	case nil:
		return "NULL"
	case bool:
		if v {
			return "TRUE"
		}
		return "FALSE"
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return fmt.Sprintf("%d", v)
	case float32:
		return strconv.FormatFloat(float64(v), 'f', -1, 32)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case time.Time:
		return "'" + v.Format("2006-01-02 15:04:05") + "'"
	case []byte:
		return hiveQuoteString(string(v))
	case string:
		return hiveQuoteString(v)
	default:
		return hiveQuoteString(fmt.Sprint(v))
	}
}

func hiveQuoteString(s string) string {
	escaped := strings.ReplaceAll(s, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `'`, `\'`)
	return "'" + escaped + "'"
}
