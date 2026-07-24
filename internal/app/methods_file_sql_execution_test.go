package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

func TestResolveSQLFileExecutionProgressPercentReservesCompletionForTerminalState(t *testing.T) {
	tests := []struct {
		name      string
		status    string
		bytesRead int64
		totalSize int64
		want      float64
	}{
		{name: "running reader reached eof", status: "running", bytesRead: 128, totalSize: 128, want: 99},
		{name: "running partial read", status: "running", bytesRead: 64, totalSize: 128, want: 50},
		{name: "done", status: "done", bytesRead: 128, totalSize: 128, want: 100},
		{name: "unknown size", status: "running", bytesRead: 64, totalSize: 0, want: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := resolveSQLFileExecutionProgressPercent(tt.status, tt.bytesRead, tt.totalSize); got != tt.want {
				t.Fatalf("percent = %v, want %v", got, tt.want)
			}
		})
	}
}

type fakeSQLFileBatchDB struct {
	batchCalls   int
	execCalls    int
	batchQueries []string
	execQueries  []string
	failBatch    bool
	failExecSQL  string
	session      *fakeSQLFileSessionDB
}

func (f *fakeSQLFileBatchDB) Connect(config connection.ConnectionConfig) error {
	return nil
}

func (f *fakeSQLFileBatchDB) Close() error {
	return nil
}

func (f *fakeSQLFileBatchDB) Ping() error {
	return nil
}

func (f *fakeSQLFileBatchDB) Query(query string) ([]map[string]interface{}, []string, error) {
	return nil, nil, nil
}

func (f *fakeSQLFileBatchDB) Exec(query string) (int64, error) {
	f.execCalls++
	f.execQueries = append(f.execQueries, query)
	if f.failExecSQL != "" && strings.Contains(query, f.failExecSQL) {
		return 0, errors.New("exec failed")
	}
	return 1, nil
}

func (f *fakeSQLFileBatchDB) ExecBatchContext(ctx context.Context, query string) (int64, error) {
	f.batchCalls++
	f.batchQueries = append(f.batchQueries, query)
	if f.failBatch {
		return 0, errors.New("batch failed")
	}
	return int64(strings.Count(query, "INSERT")), nil
}

func (f *fakeSQLFileBatchDB) GetDatabases() ([]string, error) {
	return nil, nil
}

func (f *fakeSQLFileBatchDB) GetTables(dbName string) ([]string, error) {
	return nil, nil
}

func (f *fakeSQLFileBatchDB) GetCreateStatement(dbName, tableName string) (string, error) {
	return "", nil
}

func (f *fakeSQLFileBatchDB) GetColumns(dbName, tableName string) ([]connection.ColumnDefinition, error) {
	return nil, nil
}

func (f *fakeSQLFileBatchDB) GetAllColumns(dbName string) ([]connection.ColumnDefinitionWithTable, error) {
	return nil, nil
}

func (f *fakeSQLFileBatchDB) GetIndexes(dbName, tableName string) ([]connection.IndexDefinition, error) {
	return nil, nil
}

func (f *fakeSQLFileBatchDB) GetForeignKeys(dbName, tableName string) ([]connection.ForeignKeyDefinition, error) {
	return nil, nil
}

func (f *fakeSQLFileBatchDB) GetTriggers(dbName, tableName string) ([]connection.TriggerDefinition, error) {
	return nil, nil
}

var _ db.BatchWriteExecer = (*fakeSQLFileBatchDB)(nil)

func (f *fakeSQLFileBatchDB) OpenSessionExecer(ctx context.Context) (db.StatementExecer, error) {
	f.session = &fakeSQLFileSessionDB{parent: f}
	return f.session, nil
}

type fakeSQLFileSessionDB struct {
	parent *fakeSQLFileBatchDB
	closed bool
}

func (s *fakeSQLFileSessionDB) Exec(query string) (int64, error) {
	return s.ExecContext(context.Background(), query)
}

func (s *fakeSQLFileSessionDB) ExecContext(ctx context.Context, query string) (int64, error) {
	return s.parent.Exec(query)
}

func (s *fakeSQLFileSessionDB) ExecBatchContext(ctx context.Context, query string) (int64, error) {
	return s.parent.ExecBatchContext(ctx, query)
}

func (s *fakeSQLFileSessionDB) Close() error {
	s.closed = true
	return nil
}

func TestExecuteSQLFileStreamBatchesWriteStatements(t *testing.T) {
	fakeDB := &fakeSQLFileBatchDB{}
	input := strings.Join([]string{
		"INSERT INTO demo(id) VALUES (1);",
		"INSERT INTO demo(id) VALUES (2);",
		"INSERT INTO demo(id) VALUES (3);",
	}, "\n")

	result, err := executeSQLFileStream(context.Background(), fakeDB, strings.NewReader(input), sqlFileExecutionOptions{
		DBType:             "mysql",
		BatchMaxStatements: 100,
		BatchMaxBytes:      1024,
	}, nil)
	if err != nil {
		t.Fatalf("executeSQLFileStream returned error: %v", err)
	}
	if result.Executed != 3 || result.Failed != 0 {
		t.Fatalf("expected 3 executed and 0 failed, got %#v", result)
	}
	if fakeDB.batchCalls != 1 {
		t.Fatalf("expected one batch call, got %d", fakeDB.batchCalls)
	}
	if fakeDB.execCalls != 2 {
		t.Fatalf("expected transaction wrapper exec calls only, got %d", fakeDB.execCalls)
	}
	if fakeDB.execQueries[0] != "START TRANSACTION" || fakeDB.execQueries[1] != "COMMIT" {
		t.Fatalf("expected transaction wrapper around batch, got %#v", fakeDB.execQueries)
	}
	if fakeDB.session == nil || !fakeDB.session.closed {
		t.Fatalf("expected SQL file import to use and close an isolated session")
	}
	if !strings.Contains(fakeDB.batchQueries[0], "INSERT INTO demo(id) VALUES (1);\nINSERT INTO demo(id) VALUES (2)") {
		t.Fatalf("expected batched SQL to join statements, got %q", fakeDB.batchQueries[0])
	}
}

func TestExecuteSQLFileStreamFlushesBatchBeforeReadStatement(t *testing.T) {
	fakeDB := &fakeSQLFileBatchDB{}
	input := strings.Join([]string{
		"INSERT INTO demo(id) VALUES (1);",
		"INSERT INTO demo(id) VALUES (2);",
		"SELECT * FROM demo;",
		"INSERT INTO demo(id) VALUES (3);",
	}, "\n")

	result, err := executeSQLFileStream(context.Background(), fakeDB, strings.NewReader(input), sqlFileExecutionOptions{
		DBType:             "mysql",
		BatchMaxStatements: 100,
		BatchMaxBytes:      1024,
	}, nil)
	if err != nil {
		t.Fatalf("executeSQLFileStream returned error: %v", err)
	}
	if result.Executed != 4 || result.Failed != 0 {
		t.Fatalf("expected 4 executed and 0 failed, got %#v", result)
	}
	if fakeDB.batchCalls != 2 {
		t.Fatalf("expected two batch calls around read statement, got %d", fakeDB.batchCalls)
	}
	if fakeDB.execCalls != 5 {
		t.Fatalf("expected transaction wrappers plus one read exec call, got %d", fakeDB.execCalls)
	}
	if fakeDB.execQueries[2] != "SELECT * FROM demo" {
		t.Fatalf("expected read statement to execute outside batch, got %#v", fakeDB.execQueries)
	}
}

func TestExecuteSQLFileStreamFallsBackToSequentialWhenBatchFails(t *testing.T) {
	fakeDB := &fakeSQLFileBatchDB{failBatch: true, failExecSQL: "VALUES (2)"}
	input := strings.Join([]string{
		"INSERT INTO demo(id) VALUES (1);",
		"INSERT INTO demo(id) VALUES (2);",
		"INSERT INTO demo(id) VALUES (3);",
	}, "\n")

	result, err := executeSQLFileStream(context.Background(), fakeDB, strings.NewReader(input), sqlFileExecutionOptions{
		DBType:             "mysql",
		BatchMaxStatements: 100,
		BatchMaxBytes:      1024,
	}, nil)
	if err != nil {
		t.Fatalf("executeSQLFileStream returned error: %v", err)
	}
	if result.Executed != 2 || result.Failed != 1 {
		t.Fatalf("expected 2 executed and 1 failed, got %#v", result)
	}
	if fakeDB.batchCalls != 1 {
		t.Fatalf("expected one failed batch attempt, got %d", fakeDB.batchCalls)
	}
	if fakeDB.execCalls != 5 {
		t.Fatalf("expected transaction wrapper plus 3 sequential exec calls, got %d", fakeDB.execCalls)
	}
	if fakeDB.execQueries[0] != "START TRANSACTION" || fakeDB.execQueries[1] != "ROLLBACK" {
		t.Fatalf("expected failed batch to roll back before sequential fallback, got %#v", fakeDB.execQueries)
	}
	if len(result.Errors) != 1 || result.Errors[0] != "file.backend.message.statement_failed" {
		t.Fatalf("expected per-statement error for second statement, got %#v", result.Errors)
	}
}

func TestExecuteSQLFileStreamUsesLocalizedStatementFailure(t *testing.T) {
	fakeDB := &fakeSQLFileBatchDB{failBatch: true, failExecSQL: "VALUES (2)"}
	input := strings.Join([]string{
		"INSERT INTO demo(id) VALUES (1);",
		"INSERT INTO demo(id) VALUES (2);",
	}, "\n")

	result, err := executeSQLFileStream(context.Background(), fakeDB, strings.NewReader(input), sqlFileExecutionOptions{
		DBType:             "mysql",
		BatchMaxStatements: 100,
		BatchMaxBytes:      1024,
		Text: func(key string, params map[string]any) string {
			if key != "file.backend.message.statement_failed" {
				t.Fatalf("unexpected i18n key %q", key)
			}
			return fmt.Sprintf("localized statement %v failed: %v SQL=%v", params["index"], params["detail"], params["sql"])
		},
	}, nil)
	if err != nil {
		t.Fatalf("executeSQLFileStream returned error: %v", err)
	}
	if len(result.Errors) != 1 {
		t.Fatalf("expected one localized statement error, got %#v", result.Errors)
	}
	if !strings.Contains(result.Errors[0], "localized statement 2 failed") || !strings.Contains(result.Errors[0], "VALUES (2)") {
		t.Fatalf("expected localized per-statement error with raw SQL snippet, got %#v", result.Errors)
	}
}

func TestExecuteSQLFileStreamDoesNotBatchSessionControlStatements(t *testing.T) {
	fakeDB := &fakeSQLFileBatchDB{}
	input := strings.Join([]string{
		"SET FOREIGN_KEY_CHECKS=0;",
		"INSERT INTO demo(id) VALUES (1);",
		"INSERT INTO demo(id) VALUES (2);",
		"CREATE TABLE demo2(id INT);",
		"INSERT INTO demo2(id) VALUES (3);",
	}, "\n")

	result, err := executeSQLFileStream(context.Background(), fakeDB, strings.NewReader(input), sqlFileExecutionOptions{
		DBType:             "mysql",
		BatchMaxStatements: 100,
		BatchMaxBytes:      1024,
	}, nil)
	if err != nil {
		t.Fatalf("executeSQLFileStream returned error: %v", err)
	}
	if result.Executed != 5 || result.Failed != 0 {
		t.Fatalf("expected 5 executed and 0 failed, got %#v", result)
	}
	if fakeDB.batchCalls != 2 {
		t.Fatalf("expected two DML batch calls split by control/DDL statements, got %d", fakeDB.batchCalls)
	}
	if fakeDB.execCalls != 6 {
		t.Fatalf("expected SET, CREATE, and transaction wrappers to execute sequentially, got %d", fakeDB.execCalls)
	}
	if fakeDB.execQueries[0] != "SET FOREIGN_KEY_CHECKS=0" || fakeDB.execQueries[3] != "CREATE TABLE demo2(id INT)" {
		t.Fatalf("unexpected sequential statements: %#v", fakeDB.execQueries)
	}
}

type chunkedReader struct {
	data []byte
	step int
}

func (r *chunkedReader) Read(p []byte) (int, error) {
	if len(r.data) == 0 {
		return 0, io.EOF
	}
	n := r.step
	if n <= 0 || n > len(r.data) {
		n = len(r.data)
	}
	if n > len(p) {
		n = len(p)
	}
	copy(p, r.data[:n])
	r.data = r.data[n:]
	return n, nil
}

func TestStreamSQLFileHandlesLongSingleLineAcrossChunks(t *testing.T) {
	longValue := strings.Repeat("x", 5*1024*1024)
	input := fmt.Sprintf("INSERT INTO demo(value) VALUES ('%s');SELECT 1;", longValue)
	var statements []string

	count, err := streamSQLFile(&chunkedReader{data: []byte(input), step: 257}, func(index int, stmt string) error {
		statements = append(statements, stmt)
		return nil
	})
	if err != nil {
		t.Fatalf("streamSQLFile returned error: %v", err)
	}
	if count != 2 || len(statements) != 2 {
		t.Fatalf("expected 2 statements, got count=%d statements=%d", count, len(statements))
	}
	if !strings.HasPrefix(statements[0], "INSERT INTO demo(value)") {
		t.Fatalf("expected first statement to be insert, got %.80q", statements[0])
	}
	if statements[1] != "SELECT 1" {
		t.Fatalf("expected second statement SELECT 1, got %q", statements[1])
	}
}

func TestStreamSQLFileHandlesSplitTokenBoundaries(t *testing.T) {
	input := strings.Join([]string{
		"SELECT 1 -- comment; still comment",
		"SELECT 'it''s ok';",
		"SELECT $tag$hello;world$tag$;",
		"SELECT 2；",
	}, "\n")
	var statements []string

	count, err := streamSQLFile(&chunkedReader{data: []byte(input), step: 1}, func(index int, stmt string) error {
		statements = append(statements, stmt)
		return nil
	})
	if err != nil {
		t.Fatalf("streamSQLFile returned error: %v", err)
	}
	if count != 3 || len(statements) != 3 {
		t.Fatalf("expected 3 statements, got count=%d statements=%#v", count, statements)
	}
	if statements[0] != "SELECT 1 -- comment; still comment\nSELECT 'it''s ok'" {
		t.Fatalf("unexpected first statement: %q", statements[0])
	}
	if statements[1] != "SELECT $tag$hello;world$tag$" {
		t.Fatalf("unexpected dollar-quoted statement: %q", statements[1])
	}
	if statements[2] != "SELECT 2" {
		t.Fatalf("unexpected full-width semicolon statement: %q", statements[2])
	}
}

func TestStreamSQLFileKeepsOracleAnonymousBlockTogether(t *testing.T) {
	input := strings.Join([]string{
		"BEGIN",
		"  INSERT INTO tmp_disable_trigger (table_name) VALUES ('t_memcard_reg');",
		"  UPDATE t_memcard_reg SET CARDLEVEL = 1 WHERE MEMCARDNO = '8032277312';",
		"  DELETE FROM tmp_disable_trigger WHERE table_name = 't_memcard_reg';",
		"END;",
		"SELECT 1 FROM dual;",
	}, "\n")
	var statements []string

	count, err := streamSQLFile(&chunkedReader{data: []byte(input), step: 3}, func(index int, stmt string) error {
		statements = append(statements, stmt)
		return nil
	})
	if err != nil {
		t.Fatalf("streamSQLFile returned error: %v", err)
	}
	if count != 2 || len(statements) != 2 {
		t.Fatalf("expected 2 statements, got count=%d statements=%#v", count, statements)
	}
	if statements[0] != strings.Join([]string{
		"BEGIN",
		"  INSERT INTO tmp_disable_trigger (table_name) VALUES ('t_memcard_reg');",
		"  UPDATE t_memcard_reg SET CARDLEVEL = 1 WHERE MEMCARDNO = '8032277312';",
		"  DELETE FROM tmp_disable_trigger WHERE table_name = 't_memcard_reg';",
		"END;",
	}, "\n") {
		t.Fatalf("unexpected anonymous block statement: %q", statements[0])
	}
	if statements[1] != "SELECT 1 FROM dual" {
		t.Fatalf("unexpected second statement: %q", statements[1])
	}
}

func TestStreamSQLFileKeepsOracleCreateProcedureTogether(t *testing.T) {
	input := strings.Join([]string{
		"CREATE OR REPLACE PROCEDURE proc_tally2accept(",
		"  p_tallyacceptno IN t_tally_accept_h.acceptno%TYPE,",
		"  out_acceptno OUT t_accept_h.acceptno%TYPE",
		") IS",
		"  v_busno t_tally_accept_h.busno%TYPE;",
		"  v_count PLS_INTEGER;",
		"BEGIN",
		"  SELECT COUNT(*) INTO v_count FROM t_tally_accept_h WHERE acceptno = p_tallyacceptno;",
		"  IF v_count > 0 THEN",
		"    out_acceptno := p_tallyacceptno;",
		"  END IF;",
		"END;",
		"SELECT 1 FROM dual;",
	}, "\n")
	var statements []string

	count, err := streamSQLFile(&chunkedReader{data: []byte(input), step: 5}, func(index int, stmt string) error {
		statements = append(statements, stmt)
		return nil
	})
	if err != nil {
		t.Fatalf("streamSQLFile returned error: %v", err)
	}
	if count != 2 || len(statements) != 2 {
		t.Fatalf("expected 2 statements, got count=%d statements=%#v", count, statements)
	}
	if statements[0] != strings.Join([]string{
		"CREATE OR REPLACE PROCEDURE proc_tally2accept(",
		"  p_tallyacceptno IN t_tally_accept_h.acceptno%TYPE,",
		"  out_acceptno OUT t_accept_h.acceptno%TYPE",
		") IS",
		"  v_busno t_tally_accept_h.busno%TYPE;",
		"  v_count PLS_INTEGER;",
		"BEGIN",
		"  SELECT COUNT(*) INTO v_count FROM t_tally_accept_h WHERE acceptno = p_tallyacceptno;",
		"  IF v_count > 0 THEN",
		"    out_acceptno := p_tallyacceptno;",
		"  END IF;",
		"END;",
	}, "\n") {
		t.Fatalf("unexpected create procedure statement: %q", statements[0])
	}
	if statements[1] != "SELECT 1 FROM dual" {
		t.Fatalf("unexpected second statement: %q", statements[1])
	}
}

func TestStreamSQLFileKeepsOracleCreateProcedureCursorCaseExpressionTogether(t *testing.T) {
	input := strings.Join([]string{
		"CREATE OR REPLACE PROCEDURE proc_accept_to_add(",
		"  p_acceptno IN t_accept_h.acceptno%TYPE",
		") IS",
		"  CURSOR cur_store_same(p_ind s_sys_ini.inipara%TYPE) IS",
		"    SELECT si.compid, si.batid, si.wareid",
		"    FROM t_store_i si",
		"    ORDER BY CASE",
		"      WHEN p_ind = '1' THEN",
		"        to_char(si.invalidate - to_date('19700101', 'yyyymmdd'))",
		"      WHEN p_ind = '2' THEN",
		"        lpad(to_char(floor(si.wareqty)), 10, '0')",
		"      ELSE",
		"        to_char(si.batid)",
		"    END,si.batid;",
		"BEGIN",
		"  NULL;",
		"END;",
		"/",
		"SELECT 1 FROM dual;",
	}, "\n")
	var statements []string

	count, err := streamSQLFile(&chunkedReader{data: []byte(input), step: 4}, func(index int, stmt string) error {
		statements = append(statements, stmt)
		return nil
	})
	if err != nil {
		t.Fatalf("streamSQLFile returned error: %v", err)
	}
	if count != 2 || len(statements) != 2 {
		t.Fatalf("expected 2 statements, got count=%d statements=%#v", count, statements)
	}
	if statements[0] != strings.Join([]string{
		"CREATE OR REPLACE PROCEDURE proc_accept_to_add(",
		"  p_acceptno IN t_accept_h.acceptno%TYPE",
		") IS",
		"  CURSOR cur_store_same(p_ind s_sys_ini.inipara%TYPE) IS",
		"    SELECT si.compid, si.batid, si.wareid",
		"    FROM t_store_i si",
		"    ORDER BY CASE",
		"      WHEN p_ind = '1' THEN",
		"        to_char(si.invalidate - to_date('19700101', 'yyyymmdd'))",
		"      WHEN p_ind = '2' THEN",
		"        lpad(to_char(floor(si.wareqty)), 10, '0')",
		"      ELSE",
		"        to_char(si.batid)",
		"    END,si.batid;",
		"BEGIN",
		"  NULL;",
		"END;",
	}, "\n") {
		t.Fatalf("unexpected create procedure statement: %q", statements[0])
	}
	if statements[1] != "SELECT 1 FROM dual" {
		t.Fatalf("unexpected second statement: %q", statements[1])
	}
}

func TestStreamSQLFileSkipsOracleSqlPlusSlashDelimiter(t *testing.T) {
	input := strings.Join([]string{
		"CREATE OR REPLACE PROCEDURE proc_tally2accept(",
		"  p_tallyacceptno IN t_tally_accept_h.acceptno%TYPE",
		") IS",
		"  v_count PLS_INTEGER;",
		"BEGIN",
		"  SELECT COUNT(*) INTO v_count FROM t_tally_accept_h WHERE acceptno = p_tallyacceptno;",
		"END;",
		"/",
		"SELECT 1 FROM dual;",
	}, "\n")
	var statements []string

	count, err := streamSQLFile(&chunkedReader{data: []byte(input), step: 2}, func(index int, stmt string) error {
		statements = append(statements, stmt)
		return nil
	})
	if err != nil {
		t.Fatalf("streamSQLFile returned error: %v", err)
	}
	if count != 2 || len(statements) != 2 {
		t.Fatalf("expected 2 statements, got count=%d statements=%#v", count, statements)
	}
	if statements[0] != strings.Join([]string{
		"CREATE OR REPLACE PROCEDURE proc_tally2accept(",
		"  p_tallyacceptno IN t_tally_accept_h.acceptno%TYPE",
		") IS",
		"  v_count PLS_INTEGER;",
		"BEGIN",
		"  SELECT COUNT(*) INTO v_count FROM t_tally_accept_h WHERE acceptno = p_tallyacceptno;",
		"END;",
	}, "\n") {
		t.Fatalf("unexpected create procedure statement: %q", statements[0])
	}
	if statements[1] != "SELECT 1 FROM dual" {
		t.Fatalf("unexpected second statement: %q", statements[1])
	}
}

func TestStreamSQLFileKeepsOraclePackageSpecAndBodyTogether(t *testing.T) {
	input := strings.Join([]string{
		"CREATE OR REPLACE PACKAGE pkg_order AS",
		"  PROCEDURE sync_order(p_id IN NUMBER);",
		"END pkg_order;",
		"/",
		"CREATE OR REPLACE PACKAGE BODY pkg_order AS",
		"  PROCEDURE sync_order(p_id IN NUMBER) IS",
		"  BEGIN",
		"    NULL;",
		"  END sync_order;",
		"END pkg_order;",
		"/ -- SQLPlus delimiter from PL/SQL tools",
		"SELECT 1 FROM dual;",
	}, "\n")
	var statements []string

	count, err := streamSQLFile(&chunkedReader{data: []byte(input), step: 3}, func(index int, stmt string) error {
		statements = append(statements, stmt)
		return nil
	})
	if err != nil {
		t.Fatalf("streamSQLFile returned error: %v", err)
	}
	if count != 3 || len(statements) != 3 {
		t.Fatalf("expected 3 statements, got count=%d statements=%#v", count, statements)
	}
	if statements[0] != strings.Join([]string{
		"CREATE OR REPLACE PACKAGE pkg_order AS",
		"  PROCEDURE sync_order(p_id IN NUMBER);",
		"END pkg_order;",
	}, "\n") {
		t.Fatalf("unexpected package spec statement: %q", statements[0])
	}
	if statements[1] != strings.Join([]string{
		"CREATE OR REPLACE PACKAGE BODY pkg_order AS",
		"  PROCEDURE sync_order(p_id IN NUMBER) IS",
		"  BEGIN",
		"    NULL;",
		"  END sync_order;",
		"END pkg_order;",
	}, "\n") {
		t.Fatalf("unexpected package body statement: %q", statements[1])
	}
	if statements[2] != "SELECT 1 FROM dual" {
		t.Fatalf("unexpected third statement: %q", statements[2])
	}
}

func TestResolveSQLFileExecutionRunConfigUsesServerConnectionForGoNaviMySQLDatabaseBackup(t *testing.T) {
	preamble := strings.Join([]string{
		"-- GoNavi SQL Export",
		"-- Time: 2026-07-17 00:00:00",
		"-- Database: restore_target",
		"",
		"CREATE DATABASE IF NOT EXISTS `restore_target`;",
		"",
		"USE `restore_target`;",
	}, "\n")

	got := resolveSQLFileExecutionRunConfig(
		connection.ConnectionConfig{Type: "mysql", Database: "selected_target"},
		"selected_target",
		[]byte(preamble),
	)
	if got.Database != "" {
		t.Fatalf("GoNavi MySQL database backup must connect at server level before CREATE/USE, got database=%q", got.Database)
	}
}

func TestResolveSQLFileExecutionRunConfigKeepsSelectedDatabaseForRegularSQL(t *testing.T) {
	got := resolveSQLFileExecutionRunConfig(
		connection.ConnectionConfig{Type: "mysql", Database: "configured_default"},
		"selected_target",
		[]byte("CREATE TABLE demo(id INT);"),
	)
	if got.Database != "selected_target" {
		t.Fatalf("regular SQL must retain the selected database, got database=%q", got.Database)
	}
}

func TestResolveSQLFileExecutionRunConfigUsesServerConnectionForLegacyGoNaviMySQLDatabaseBackup(t *testing.T) {
	preamble := strings.Join([]string{
		"-- GoNavi SQL Export",
		"-- Time: 2026-07-11 00:00:00",
		"-- Database: legacy_restore_target",
		"",
		"USE `legacy_restore_target`;",
	}, "\n")

	got := resolveSQLFileExecutionRunConfig(
		connection.ConnectionConfig{Type: "mysql", Database: "selected_target"},
		"selected_target",
		[]byte(preamble),
	)
	if got.Database != "" {
		t.Fatalf("legacy GoNavi MySQL database backup must connect at server level before USE, got database=%q", got.Database)
	}
}

func TestBuildGoNaviMySQLDatabaseBackupBootstrapSQLOnlyForLegacyBackup(t *testing.T) {
	legacy := goNaviMySQLDatabaseBackupPreamble{databaseName: "legacy_restore_target"}
	if got := buildGoNaviMySQLDatabaseBackupBootstrapSQL(legacy); got != "CREATE DATABASE IF NOT EXISTS `legacy_restore_target`" {
		t.Fatalf("unexpected legacy bootstrap SQL: %q", got)
	}

	current := goNaviMySQLDatabaseBackupPreamble{
		databaseName:           "current_restore_target",
		includesCreateDatabase: true,
	}
	if got := buildGoNaviMySQLDatabaseBackupBootstrapSQL(current); got != "" {
		t.Fatalf("backup that already creates its database must not be bootstrapped again, got %q", got)
	}
}

func TestExecuteSQLFileStreamRunsGoNaviMySQLDatabaseBackupHeader(t *testing.T) {
	fakeDB := &fakeSQLFileBatchDB{}
	input := strings.Join([]string{
		"-- GoNavi SQL Export",
		"-- Database: restore_target",
		"CREATE DATABASE IF NOT EXISTS `restore_target`;",
		"USE `restore_target`;",
		"SET FOREIGN_KEY_CHECKS=0;",
		"CREATE TABLE users(id INT PRIMARY KEY);",
		"INSERT INTO users(id) VALUES (1);",
		"SET FOREIGN_KEY_CHECKS=1;",
	}, "\n")

	result, err := executeSQLFileStream(context.Background(), fakeDB, strings.NewReader(input), sqlFileExecutionOptions{
		DBType:             "mysql",
		BatchMaxStatements: 100,
		BatchMaxBytes:      1024,
	}, nil)
	if err != nil {
		t.Fatalf("executeSQLFileStream returned error: %v", err)
	}
	if result.Executed != 6 || result.Failed != 0 {
		t.Fatalf("expected complete database backup header and statements to execute, got %#v", result)
	}
	joinedExec := strings.Join(fakeDB.execQueries, "\n")
	for _, expected := range []string{
		"CREATE DATABASE IF NOT EXISTS `restore_target`",
		"USE `restore_target`",
		"CREATE TABLE users(id INT PRIMARY KEY)",
		"SET FOREIGN_KEY_CHECKS=1",
	} {
		if !strings.Contains(joinedExec, expected) {
			t.Fatalf("expected backup statement %q to execute, queries=%#v", expected, fakeDB.execQueries)
		}
	}
	if len(fakeDB.batchQueries) != 1 || !strings.Contains(fakeDB.batchQueries[0], "INSERT INTO users(id) VALUES (1)") {
		t.Fatalf("expected INSERT data to be batched after schema restore, batches=%#v", fakeDB.batchQueries)
	}
}

func TestImportDatabaseSQLHonorsConnectionProtections(t *testing.T) {
	allowedFilePath := filepath.Join(t.TempDir(), "database.sql")
	if err := os.WriteFile(allowedFilePath, []byte("CREATE TABLE demo(id INT);"), 0o600); err != nil {
		t.Fatalf("write SQL import fixture: %v", err)
	}
	missingFilePath := filepath.Join(t.TempDir(), "missing.sql")

	tests := []struct {
		name       string
		protection connection.ConnectionProtectionConfig
		filePath   string
		wantBlock  bool
	}{
		{
			name:       "data import restricted",
			protection: connection.ConnectionProtectionConfig{RestrictDataImport: true},
			filePath:   missingFilePath,
			wantBlock:  true,
		},
		{
			name:       "structure edit restricted",
			protection: connection.ConnectionProtectionConfig{RestrictStructureEdit: true},
			filePath:   missingFilePath,
			wantBlock:  true,
		},
		{
			name:       "script execution restricted",
			protection: connection.ConnectionProtectionConfig{RestrictScriptExecution: true},
			filePath:   missingFilePath,
			wantBlock:  true,
		},
		{
			name:      "allowed",
			filePath:  allowedFilePath,
			wantBlock: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			originalNewDatabaseFunc := newDatabaseFunc
			t.Cleanup(func() { newDatabaseFunc = originalNewDatabaseFunc })

			opened := false
			fakeDB := &fakeSQLFileBatchDB{}
			newDatabaseFunc = func(string) (db.Database, error) {
				opened = true
				return fakeDB, nil
			}

			app := NewApp()
			result := app.ImportDatabaseSQL(connection.ConnectionConfig{
				Type:       "mysql",
				Protection: test.protection,
			}, "app", test.filePath, "database-import-protection-test")

			if test.wantBlock {
				if result.Success {
					t.Fatalf("ImportDatabaseSQL unexpectedly succeeded: %#v", result)
				}
				wantMessage := readOnlyConnectionActionBlockedMessageWithText(
					"connection.backend.action.import_data",
					app.appText,
				)
				if result.Message != wantMessage {
					t.Fatalf("blocked message = %q, want %q", result.Message, wantMessage)
				}
				if opened {
					t.Fatal("ImportDatabaseSQL opened a database despite connection protection")
				}
				return
			}

			if !result.Success {
				t.Fatalf("ImportDatabaseSQL returned failure: %#v", result)
			}
			if !opened {
				t.Fatal("ImportDatabaseSQL did not open a database on the allowed path")
			}
			if len(fakeDB.execQueries) != 1 || fakeDB.execQueries[0] != "CREATE TABLE demo(id INT)" {
				t.Fatalf("unexpected executed SQL: %#v", fakeDB.execQueries)
			}
		})
	}
}
