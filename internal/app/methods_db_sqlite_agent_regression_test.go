package app

import (
	"context"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/sqlaudit"
)

// fakeUnsupportedMultiResultDB mirrors OptionalDriverAgentDB: the database-level
// multi-result method reports unsupported as nil while its pinned session only
// exposes the plain query API.
type fakeUnsupportedMultiResultDB struct {
	*fakeBatchWriteDB
	multiCalls int
	session    *fakePlainQuerySession
}

func (f *fakeUnsupportedMultiResultDB) QueryMulti(query string) ([]connection.ResultSetData, error) {
	results, _, err := f.QueryMultiWithMessages(query)
	return results, err
}

func (f *fakeUnsupportedMultiResultDB) QueryMultiWithMessages(query string) ([]connection.ResultSetData, []string, error) {
	return f.QueryMultiContextWithMessages(context.Background(), query)
}

func (f *fakeUnsupportedMultiResultDB) QueryMultiContext(ctx context.Context, query string) ([]connection.ResultSetData, error) {
	results, _, err := f.QueryMultiContextWithMessages(ctx, query)
	return results, err
}

func (f *fakeUnsupportedMultiResultDB) QueryMultiContextWithMessages(context.Context, string) ([]connection.ResultSetData, []string, error) {
	f.multiCalls++
	return nil, nil, nil
}

func (f *fakeUnsupportedMultiResultDB) OpenSessionExecer(context.Context) (db.StatementExecer, error) {
	f.session = &fakePlainQuerySession{parent: f.fakeBatchWriteDB}
	return f.session, nil
}

type fakePlainQuerySession struct {
	parent     *fakeBatchWriteDB
	queryCalls int
}

func (s *fakePlainQuerySession) Query(query string) ([]map[string]interface{}, []string, error) {
	return s.QueryContext(context.Background(), query)
}

func (s *fakePlainQuerySession) QueryContext(ctx context.Context, query string) ([]map[string]interface{}, []string, error) {
	s.queryCalls++
	return s.parent.QueryContext(ctx, query)
}

func (s *fakePlainQuerySession) QueryWithMessages(query string) ([]map[string]interface{}, []string, []string, error) {
	return s.QueryContextWithMessages(context.Background(), query)
}

func (s *fakePlainQuerySession) QueryContextWithMessages(ctx context.Context, query string) ([]map[string]interface{}, []string, []string, error) {
	s.queryCalls++
	return s.parent.QueryContextWithMessages(ctx, query)
}

func (s *fakePlainQuerySession) Exec(query string) (int64, error) {
	return s.ExecContext(context.Background(), query)
}

func (s *fakePlainQuerySession) ExecContext(ctx context.Context, query string) (int64, error) {
	return s.parent.ExecContext(ctx, query)
}

func (s *fakePlainQuerySession) Close() error { return nil }

type fakeUnsupportedMultiResultSession struct {
	*fakePlainQuerySession
	multiCalls int
}

func (s *fakeUnsupportedMultiResultSession) QueryMulti(query string) ([]connection.ResultSetData, error) {
	results, _, err := s.QueryMultiWithMessages(query)
	return results, err
}

func (s *fakeUnsupportedMultiResultSession) QueryMultiWithMessages(query string) ([]connection.ResultSetData, []string, error) {
	return s.QueryMultiContextWithMessages(context.Background(), query)
}

func (s *fakeUnsupportedMultiResultSession) QueryMultiContext(ctx context.Context, query string) ([]connection.ResultSetData, error) {
	results, _, err := s.QueryMultiContextWithMessages(ctx, query)
	return results, err
}

func (s *fakeUnsupportedMultiResultSession) QueryMultiContextWithMessages(context.Context, string) ([]connection.ResultSetData, []string, error) {
	s.multiCalls++
	return nil, nil, nil
}

func installFakeOptionalDriverDatabase(t *testing.T, fakeDB db.Database) {
	t.Helper()
	originalNewDatabaseFunc := newDatabaseFunc
	originalDriverRuntimeSupportStatusFunc := driverRuntimeSupportStatusFunc
	originalVerifyDriverAgentRevisionFunc := verifyDriverAgentRevisionFunc
	t.Cleanup(func() {
		newDatabaseFunc = originalNewDatabaseFunc
		driverRuntimeSupportStatusFunc = originalDriverRuntimeSupportStatusFunc
		verifyDriverAgentRevisionFunc = originalVerifyDriverAgentRevisionFunc
	})
	newDatabaseFunc = func(string) (db.Database, error) { return fakeDB, nil }
	driverRuntimeSupportStatusFunc = func(string) (bool, string) { return true, "" }
	verifyDriverAgentRevisionFunc = func(connection.ConnectionConfig) error { return nil }
}

func TestDBQueryMultiSQLiteAgentStyleQueryReturnsRowsAndAuditCount(t *testing.T) {
	query := "SELECT id, name FROM orders"
	baseDB := &fakeBatchWriteDB{
		queryMap: map[string][]map[string]interface{}{
			query: {{"id": 1, "name": "SQLite agent row"}},
		},
		fieldMap: map[string][]string{
			query: {"id", "name"},
		},
		queryErr: map[string]error{},
	}
	fakeDB := &fakeUnsupportedMultiResultDB{fakeBatchWriteDB: baseDB}
	installFakeOptionalDriverDatabase(t, fakeDB)

	app := newSQLAuditTestApp(t)
	config := connection.ConnectionConfig{Type: "sqlite", Host: "/tmp/orders.sqlite"}
	result := app.DBQueryMulti(config, "", query, "sqlite-agent-select")
	if !result.Success {
		t.Fatalf("SQLite agent-style SELECT returned failure: %s", result.Message)
	}
	resultSets, ok := result.Data.([]connection.ResultSetData)
	if !ok || len(resultSets) != 1 || len(resultSets[0].Rows) != 1 {
		t.Fatalf("SQLite agent-style SELECT result sets = %#v, want one row", result.Data)
	}
	if fakeDB.multiCalls != 0 {
		t.Fatalf("SQLite plain SELECT should not probe unsupported multi-result API, calls=%d", fakeDB.multiCalls)
	}
	if fakeDB.session == nil || fakeDB.session.queryCalls != 1 {
		t.Fatalf("SQLite plain SELECT should use one pinned-session query, session=%#v", fakeDB.session)
	}

	events := loadSQLAuditEvents(t, app, sqlaudit.Filter{Search: "sqlite-agent-select", PageSize: 10})
	if len(events) != 1 || events[0].RowsReturned != 1 {
		t.Fatalf("SQLite SELECT audit events = %#v, want RowsReturned=1", events)
	}
}

func TestDBQueryMultiFallsBackWhenMultiResultReportsUnsupportedAsNil(t *testing.T) {
	query := "SELECT id FROM users"
	baseDB := &fakeBatchWriteDB{
		queryMap: map[string][]map[string]interface{}{
			query: {{"id": 7}},
		},
		fieldMap: map[string][]string{
			query: {"id"},
		},
		queryErr: map[string]error{},
	}
	fakeDB := &fakeUnsupportedMultiResultDB{fakeBatchWriteDB: baseDB}
	originalNewDatabaseFunc := newDatabaseFunc
	t.Cleanup(func() { newDatabaseFunc = originalNewDatabaseFunc })
	newDatabaseFunc = func(string) (db.Database, error) { return fakeDB, nil }

	app := NewApp()
	result := app.DBQueryMulti(connection.ConnectionConfig{Type: "mysql"}, "main", query, "nil-multi-result")
	if !result.Success {
		t.Fatalf("DBQueryMulti returned failure: %s", result.Message)
	}
	resultSets, ok := result.Data.([]connection.ResultSetData)
	if !ok || len(resultSets) != 1 || len(resultSets[0].Rows) != 1 {
		t.Fatalf("DBQueryMulti result sets = %#v, want one row", result.Data)
	}
	if fakeDB.multiCalls != 2 {
		t.Fatalf("expected batch and statement multi-result probes before fallback, calls=%d", fakeDB.multiCalls)
	}
	if fakeDB.session == nil || fakeDB.session.queryCalls != 1 {
		t.Fatalf("expected one plain pinned-session fallback, session=%#v", fakeDB.session)
	}
}

func TestDBQueryMultiDoesNotRetryQueryFirstWriteWhenMultiResultReturnsNil(t *testing.T) {
	query := "INSERT INTO users(id) VALUES (11) RETURNING id"
	baseDB := &fakeBatchWriteDB{
		queryMap: map[string][]map[string]interface{}{
			query: {{"id": 11}},
		},
		fieldMap: map[string][]string{
			query: {"id"},
		},
		queryErr: map[string]error{},
	}
	fakeDB := &fakeUnsupportedMultiResultDB{fakeBatchWriteDB: baseDB}
	originalNewDatabaseFunc := newDatabaseFunc
	t.Cleanup(func() { newDatabaseFunc = originalNewDatabaseFunc })
	newDatabaseFunc = func(string) (db.Database, error) { return fakeDB, nil }

	app := NewApp()
	result := app.DBQueryMulti(connection.ConnectionConfig{Type: "postgres"}, "main", query, "nil-write-result")
	if !result.Success {
		t.Fatalf("query-first write returned failure: %s", result.Message)
	}
	if fakeDB.multiCalls != 1 {
		t.Fatalf("expected the query-first write to execute once, multi calls=%d", fakeDB.multiCalls)
	}
	if fakeDB.session == nil || fakeDB.session.queryCalls != 0 {
		t.Fatalf("query-first write must not retry through plain Query, session=%#v", fakeDB.session)
	}
}

func TestManagedTransactionFallsBackWhenMultiResultReportsUnsupportedAsNil(t *testing.T) {
	query := "SELECT id FROM users"
	baseDB := &fakeBatchWriteDB{
		queryMap: map[string][]map[string]interface{}{
			query: {{"id": 9}},
		},
		fieldMap: map[string][]string{
			query: {"id"},
		},
		queryErr: map[string]error{},
	}
	session := &fakeUnsupportedMultiResultSession{
		fakePlainQuerySession: &fakePlainQuerySession{parent: baseDB},
	}

	resultSets, err := executeManagedSQLTransactionStatements(
		context.Background(),
		session,
		connection.ConnectionConfig{Type: "mysql"},
		[]string{query},
		defaultDBBackendText,
	)
	if err != nil {
		t.Fatalf("managed transaction SELECT returned failure: %v", err)
	}
	if len(resultSets) != 1 || len(resultSets[0].Rows) != 1 {
		t.Fatalf("managed transaction result sets = %#v, want one row", resultSets)
	}
	if session.multiCalls != 1 || session.queryCalls != 1 {
		t.Fatalf("expected one multi-result probe and one plain fallback, multi=%d plain=%d", session.multiCalls, session.queryCalls)
	}
}

var _ db.MultiResultQueryMessageExecer = (*fakeUnsupportedMultiResultDB)(nil)
var _ db.SessionExecerProvider = (*fakeUnsupportedMultiResultDB)(nil)
var _ db.StatementQueryMessageExecer = (*fakePlainQuerySession)(nil)
var _ db.StatementMultiResultQueryMessageExecer = (*fakeUnsupportedMultiResultSession)(nil)
