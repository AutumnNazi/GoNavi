package app

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

type fakeTDengineOptionalAgentDB struct {
	*fakeUnsupportedMultiResultDB
}

func (*fakeTDengineOptionalAgentDB) OpenSessionExecer(context.Context) (db.StatementExecer, error) {
	return nil, errors.New("TDengine driver does not support pinned sessions")
}

func TestDBQueryMultiTDengineAgentSelectUsesPlainQuery(t *testing.T) {
	query := "SELECT ts, current FROM meters ORDER BY ts DESC LIMIT 1"
	baseDB := &fakeBatchWriteDB{
		queryMap: map[string][]map[string]interface{}{
			query: {{"ts": "2026-07-19T00:00:00+08:00", "current": 10.2}},
		},
		fieldMap: map[string][]string{
			query: {"ts", "current"},
		},
		queryErr: map[string]error{},
	}
	fakeDB := &fakeTDengineOptionalAgentDB{
		fakeUnsupportedMultiResultDB: &fakeUnsupportedMultiResultDB{fakeBatchWriteDB: baseDB},
	}
	installFakeOptionalDriverDatabase(t, fakeDB)

	app := NewApp()
	result := app.DBQueryMulti(
		connection.ConnectionConfig{Type: "tdengine", Host: "127.0.0.1", Port: 6041},
		"power",
		query,
		"tdengine-agent-select",
	)
	if !result.Success {
		t.Fatalf("TDengine agent SELECT returned failure: %s", result.Message)
	}

	resultSets, ok := result.Data.([]connection.ResultSetData)
	if !ok || len(resultSets) != 1 {
		t.Fatalf("TDengine agent SELECT result sets = %#v, want one result set", result.Data)
	}
	if !reflect.DeepEqual(resultSets[0].Columns, []string{"ts", "current"}) {
		t.Fatalf("TDengine agent SELECT columns = %#v", resultSets[0].Columns)
	}
	if len(resultSets[0].Rows) != 1 || resultSets[0].Rows[0]["current"] != 10.2 {
		t.Fatalf("TDengine agent SELECT rows = %#v, want one data row", resultSets[0].Rows)
	}
	if fakeDB.multiCalls != 0 {
		t.Fatalf("TDengine SELECT must not probe unsupported multi-result API, calls=%d", fakeDB.multiCalls)
	}
	if baseDB.queryCalls != 1 {
		t.Fatalf("TDengine SELECT should execute exactly once through plain Query, calls=%d", baseDB.queryCalls)
	}
}
