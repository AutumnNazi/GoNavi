//go:build gonavi_full_drivers || gonavi_dameng_driver

package db

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
)

type damengColumnsMetadataDriver struct{}

type damengColumnsMetadataConn struct{}

type damengColumnsMetadataRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

var registerDamengColumnsMetadataDriverOnce sync.Once

var damengColumnsMetadataQueryState struct {
	sync.Mutex
	failAutoIncrementQuery bool
	queries                []string
}

func (damengColumnsMetadataDriver) Open(name string) (driver.Conn, error) {
	return damengColumnsMetadataConn{}, nil
}

func (damengColumnsMetadataConn) Prepare(query string) (driver.Stmt, error) {
	return nil, errors.New("prepared statements are not supported by this test driver")
}

func (damengColumnsMetadataConn) Close() error { return nil }

func (damengColumnsMetadataConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions are not supported by this test driver")
}

func (damengColumnsMetadataConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	damengColumnsMetadataQueryState.Lock()
	damengColumnsMetadataQueryState.queries = append(damengColumnsMetadataQueryState.queries, query)
	failAutoIncrementQuery := damengColumnsMetadataQueryState.failAutoIncrementQuery
	damengColumnsMetadataQueryState.Unlock()

	if strings.Contains(query, "SYS.SYSCOLUMNS") {
		if failAutoIncrementQuery {
			return nil, errors.New("insufficient privilege for SYS.SYSCOLUMNS")
		}
		return &damengColumnsMetadataRows{
			columns: []string{"COLUMN_NAME"},
			values:  [][]driver.Value{{"ID"}},
		}, nil
	}

	return &damengColumnsMetadataRows{
		columns: []string{
			"COLUMN_NAME", "DATA_TYPE", "DATA_LENGTH", "CHAR_LENGTH", "DATA_PRECISION",
			"DATA_SCALE", "NULLABLE", "DATA_DEFAULT", "COL_COMMENT", "COLUMN_KEY",
		},
		values: [][]driver.Value{
			{"ID", "NUMBER", nil, nil, int64(10), int64(0), "N", nil, "", "PRI"},
			{"NAME", "VARCHAR2", int64(64), int64(64), nil, nil, "Y", nil, "", ""},
		},
	}, nil
}

func (r *damengColumnsMetadataRows) Columns() []string { return r.columns }

func (r *damengColumnsMetadataRows) Close() error { return nil }

func (r *damengColumnsMetadataRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}

func openDamengColumnsMetadataDB(t *testing.T) *sql.DB {
	t.Helper()

	registerDamengColumnsMetadataDriverOnce.Do(func() {
		sql.Register("dameng_columns_metadata", damengColumnsMetadataDriver{})
	})

	conn, err := sql.Open("dameng_columns_metadata", "")
	if err != nil {
		t.Fatalf("open dameng_columns_metadata test DB failed: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})
	return conn
}

func resetDamengColumnsMetadataQueryState(t *testing.T, failAutoIncrementQuery bool) {
	t.Helper()

	damengColumnsMetadataQueryState.Lock()
	damengColumnsMetadataQueryState.failAutoIncrementQuery = failAutoIncrementQuery
	damengColumnsMetadataQueryState.queries = nil
	damengColumnsMetadataQueryState.Unlock()
	t.Cleanup(func() {
		damengColumnsMetadataQueryState.Lock()
		damengColumnsMetadataQueryState.failAutoIncrementQuery = false
		damengColumnsMetadataQueryState.queries = nil
		damengColumnsMetadataQueryState.Unlock()
	})
}

func damengColumnsMetadataQueries() []string {
	damengColumnsMetadataQueryState.Lock()
	defer damengColumnsMetadataQueryState.Unlock()
	return append([]string(nil), damengColumnsMetadataQueryState.queries...)
}

func TestDamengGetColumnsMarksAutoIncrementColumns(t *testing.T) {
	resetDamengColumnsMetadataQueryState(t, false)

	damengDB := &DamengDB{conn: openDamengColumnsMetadataDB(t)}
	columns, err := damengDB.GetColumns("biz", "orders")
	if err != nil {
		t.Fatalf("GetColumns returned error: %v", err)
	}
	if len(columns) != 2 {
		t.Fatalf("unexpected column count: %d", len(columns))
	}
	if columns[0].Extra != "auto_increment" {
		t.Fatalf("identity column should be marked as auto_increment: %+v", columns[0])
	}
	if columns[1].Extra != "" {
		t.Fatalf("non-identity column should not be marked: %+v", columns[1])
	}

	queries := damengColumnsMetadataQueries()
	if len(queries) != 2 || !strings.Contains(queries[1], "SYS.SYSCOLUMNS") {
		t.Fatalf("expected base and system metadata queries, got=%v", queries)
	}
}

func TestDamengGetColumnsKeepsBaseMetadataWhenAutoIncrementQueryFails(t *testing.T) {
	resetDamengColumnsMetadataQueryState(t, true)

	damengDB := &DamengDB{conn: openDamengColumnsMetadataDB(t)}
	columns, err := damengDB.GetColumns("biz", "orders")
	if err != nil {
		t.Fatalf("GetColumns should keep base metadata when auto-increment lookup fails: %v", err)
	}
	if len(columns) != 2 || columns[0].Name != "ID" || columns[0].Extra != "" {
		t.Fatalf("unexpected fallback columns: %+v", columns)
	}
}
