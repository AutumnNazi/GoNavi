package db

import (
	"bufio"
	"bytes"
	"context"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestNormalizeKingbaseAgentTableName(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "plain", in: "ldf_server.andon_events", want: "ldf_server.andon_events"},
		{name: "quoted", in: `"ldf_server"."andon_events"`, want: "ldf_server.andon_events"},
		{name: "double quoted", in: `""ldf_server"".""andon_events""`, want: "ldf_server.andon_events"},
		{name: "escaped", in: `\"ldf_server\".\"andon_events\"`, want: "ldf_server.andon_events"},
		{name: "double escaped", in: `\\\"ldf_server\\\".\\\"andon_events\\\"`, want: "ldf_server.andon_events"},
		{name: "space around dot", in: ` "ldf_server" . "andon_events" `, want: "ldf_server.andon_events"},
		{name: "table only", in: `bcs_barcode`, want: "bcs_barcode"},
		{name: "table only quoted", in: `"bcs_barcode"`, want: "bcs_barcode"},
		{name: "table only double quoted", in: `""bcs_barcode""`, want: "bcs_barcode"},
		{name: "table only double escaped", in: `\\\"bcs_barcode\\\"`, want: "bcs_barcode"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeKingbaseAgentTableName(tt.in); got != tt.want {
				t.Fatalf("normalizeKingbaseAgentTableName(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestNormalizeKingbaseAgentChangeSetByColumns(t *testing.T) {
	columns := []string{"andon_events_id", "event_name", "event_code"}
	input := connection.ChangeSet{
		Inserts: []map[string]interface{}{
			{"event name": "物料1", "event_code": "EV-0001", "andon_events_id": 1},
		},
		Updates: []connection.UpdateRow{
			{Keys: map[string]interface{}{"andon_events_id": 1}, Values: map[string]interface{}{"event name": "物料2"}},
		},
		Deletes: []map[string]interface{}{
			{"andon_events_id": 1},
		},
	}

	out, err := normalizeKingbaseAgentChangeSetByColumns(input, columns)
	if err != nil {
		t.Fatalf("normalizeKingbaseAgentChangeSetByColumns error: %v", err)
	}

	if _, ok := out.Inserts[0]["event_name"]; !ok {
		t.Fatalf("expected insert to map \"event name\" -> \"event_name\"")
	}
	if _, ok := out.Inserts[0]["event name"]; ok {
		t.Fatalf("unexpected insert key \"event name\" after normalization")
	}
	if _, ok := out.Updates[0].Values["event_name"]; !ok {
		t.Fatalf("expected update values to map \"event name\" -> \"event_name\"")
	}
	if _, ok := out.Updates[0].Values["event name"]; ok {
		t.Fatalf("unexpected update value key \"event name\" after normalization")
	}
}

type optionalAgentTestWriteCloser struct {
	bytes.Buffer
}

func (w *optionalAgentTestWriteCloser) Close() error { return nil }

type optionalAgentTestStreamConsumer struct {
	columns []string
	rows    [][]interface{}
}

func (c *optionalAgentTestStreamConsumer) SetColumns(columns []string) error {
	c.columns = append([]string(nil), columns...)
	return nil
}

func (c *optionalAgentTestStreamConsumer) ConsumeRow(row map[string]interface{}) error {
	values := make([]interface{}, len(c.columns))
	for idx, column := range c.columns {
		values[idx] = row[column]
	}
	c.rows = append(c.rows, values)
	return nil
}

func (c *optionalAgentTestStreamConsumer) ConsumeRowValues(values []interface{}) error {
	c.rows = append(c.rows, append([]interface{}(nil), values...))
	return nil
}

func TestOptionalDriverAgentClientCallStreamQueryConsumesChunks(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	stdout := strings.Join([]string{
		`{"id":1,"success":true,"chunkType":"columns","fields":["id","name"]}`,
		`{"id":1,"success":true,"chunkType":"rows","data":[[1,"alice"],[2,"bob"]]}`,
		`{"id":1,"success":true,"chunkType":"done"}`,
	}, "\n") + "\n"

	client := &optionalDriverAgentClient{
		stdin:  &stdin,
		reader: bufio.NewReader(strings.NewReader(stdout)),
		driver: "oceanbase",
	}
	consumer := &optionalAgentTestStreamConsumer{}
	if err := client.callStreamQuery(optionalAgentRequest{
		Method: optionalAgentMethodStreamQuery,
		Query:  "SELECT 1",
	}, consumer); err != nil {
		t.Fatalf("callStreamQuery 返回错误: %v", err)
	}

	if len(consumer.columns) != 2 || consumer.columns[0] != "id" || consumer.columns[1] != "name" {
		t.Fatalf("流式列定义异常: %#v", consumer.columns)
	}
	if len(consumer.rows) != 2 {
		t.Fatalf("流式行数异常: %#v", consumer.rows)
	}
	if got := consumer.rows[0][1]; got != "alice" {
		t.Fatalf("第 1 行数据异常，want=%q got=%v", "alice", got)
	}
	if got := consumer.rows[1][0]; got != int64(2) {
		t.Fatalf("第 2 行 ID 异常，want=%d got=%v (%T)", 2, got, got)
	}
	if !strings.Contains(stdin.String(), `"method":"streamQuery"`) {
		t.Fatalf("请求未使用 streamQuery 方法: %s", stdin.String())
	}
}

func TestOptionalDriverAgentDBQueryWithMessagesParsesAgentMessages(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	stdout := `{"id":1,"success":true,"data":[{"sql_text":"select 1"}],"fields":["sql_text"],"messages":["PRINT sql line 1","PRINT sql line 2"]}` + "\n"

	dbInst := &OptionalDriverAgentDB{
		driverType: "sqlserver",
		client: &optionalDriverAgentClient{
			stdin:  &stdin,
			reader: bufio.NewReader(strings.NewReader(stdout)),
			driver: "sqlserver",
		},
	}

	rows, fields, messages, err := dbInst.QueryWithMessages("exec dbo.p_get_select")
	if err != nil {
		t.Fatalf("QueryWithMessages 返回错误: %v", err)
	}
	if len(rows) != 1 || rows[0]["sql_text"] != "select 1" {
		t.Fatalf("查询结果异常: %#v", rows)
	}
	if len(fields) != 1 || fields[0] != "sql_text" {
		t.Fatalf("字段异常: %#v", fields)
	}
	if len(messages) != 2 || messages[0] != "PRINT sql line 1" {
		t.Fatalf("消息异常: %#v", messages)
	}
	if !strings.Contains(stdin.String(), `"method":"query"`) {
		t.Fatalf("请求未使用 query 方法: %s", stdin.String())
	}
}

func TestOptionalDriverAgentDBProvidesSQLiteTableStats(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	stdout := strings.Join([]string{
		`{"id":1,"success":true,"data":[{"table_rows":2}],"fields":["table_rows"]}`,
		`{"id":2,"success":true,"data":[{"table_name":"orders","data_length":4096,"index_length":8192}],"fields":["table_name","data_length","index_length"]}`,
	}, "\n") + "\n"

	dbInst := &OptionalDriverAgentDB{
		driverType: "sqlite",
		client: &optionalDriverAgentClient{
			stdin:  &stdin,
			reader: bufio.NewReader(strings.NewReader(stdout)),
			driver: "sqlite",
		},
	}

	rowCounts, err := dbInst.GetTableRowCounts("main", []string{"orders"})
	if err != nil {
		t.Fatalf("GetTableRowCounts 返回错误: %v", err)
	}
	if rowCounts["orders"] != 2 {
		t.Fatalf("SQLite driver-agent 行数异常: %#v", rowCounts)
	}

	storageStats, err := dbInst.GetTableStorageStats("main", []string{"orders"})
	if err != nil {
		t.Fatalf("GetTableStorageStats 返回错误: %v", err)
	}
	if storageStats["orders"].DataLength != 4096 || storageStats["orders"].IndexLength != 8192 {
		t.Fatalf("SQLite driver-agent 存储统计异常: %#v", storageStats)
	}

	requests := stdin.String()
	if !strings.Contains(requests, `SELECT COUNT(*) AS table_rows FROM \"orders\"`) {
		t.Fatalf("driver-agent 未执行 SQLite 行数查询: %s", requests)
	}
	if !strings.Contains(requests, "FROM dbstat") {
		t.Fatalf("driver-agent 未执行 SQLite dbstat 查询: %s", requests)
	}
}

func TestOptionalDriverAgentDBQueryMultiWithMessagesParsesResultSets(t *testing.T) {
	var stdin optionalAgentTestWriteCloser
	stdout := `{"id":1,"success":true,"data":[{"statementIndex":1,"rows":[{"name":"master"}],"columns":["name"]},{"statementIndex":1,"rows":[],"columns":[],"messages":["PRINT generated sql"]}],"messages":["batch top-level message"]}` + "\n"

	dbInst := &OptionalDriverAgentDB{
		driverType: "sqlserver",
		client: &optionalDriverAgentClient{
			stdin:  &stdin,
			reader: bufio.NewReader(strings.NewReader(stdout)),
			driver: "sqlserver",
		},
	}

	resultSets, messages, err := dbInst.QueryMultiWithMessages("exec dbo.p_get_select")
	if err != nil {
		t.Fatalf("QueryMultiWithMessages 返回错误: %v", err)
	}
	if len(resultSets) != 2 {
		t.Fatalf("结果集数量异常: %#v", resultSets)
	}
	if got := resultSets[0].Rows[0]["name"]; got != "master" {
		t.Fatalf("首个结果集异常，got=%v", got)
	}
	if len(resultSets[1].Messages) != 1 || resultSets[1].Messages[0] != "PRINT generated sql" {
		t.Fatalf("消息结果集异常: %#v", resultSets[1])
	}
	if len(messages) != 1 || messages[0] != "batch top-level message" {
		t.Fatalf("顶层消息异常: %#v", messages)
	}
	if !strings.Contains(stdin.String(), `"method":"queryMulti"`) {
		t.Fatalf("请求未使用 queryMulti 方法: %s", stdin.String())
	}
}

func TestDamengOptionalDriverAgentSupportsManagedTransactions(t *testing.T) {
	damengDB, err := NewDatabase("dameng")
	if err != nil {
		t.Fatalf("create Dameng optional driver database: %v", err)
	}
	if _, ok := damengDB.(TransactionExecerProvider); !ok {
		t.Fatal("expected Dameng optional driver database to expose managed transactions")
	}

	for _, dbType := range []string{"sqlserver", "kingbase"} {
		dbInst, err := NewDatabase(dbType)
		if err != nil {
			t.Fatalf("create %s optional driver database: %v", dbType, err)
		}
		if _, ok := dbInst.(TransactionExecerProvider); ok {
			t.Fatalf("expected %s to keep using its existing session transaction path", dbType)
		}
	}
}

func TestOptionalDriverAgentTransactionUsesTransactionRPC(t *testing.T) {
	for _, tc := range []struct {
		name         string
		finishMethod string
		finish       func(TransactionExecer) error
	}{
		{name: "commit", finishMethod: optionalAgentMethodCommitTransaction, finish: func(tx TransactionExecer) error { return tx.Commit() }},
		{name: "rollback", finishMethod: optionalAgentMethodRollbackTransaction, finish: func(tx TransactionExecer) error { return tx.Rollback() }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var stdin optionalAgentTestWriteCloser
			stdout := strings.Join([]string{
				`{"id":1,"success":true,"data":"transaction-1"}`,
				`{"id":2,"success":true,"rowsAffected":1}`,
				`{"id":3,"success":true}`,
				`{"id":4,"success":true}`,
			}, "\n") + "\n"
			dbInst := &optionalDriverAgentTransactionalDB{
				OptionalDriverAgentDB: &OptionalDriverAgentDB{
					driverType: "dameng",
					client: &optionalDriverAgentClient{
						stdin:  &stdin,
						reader: bufio.NewReader(strings.NewReader(stdout)),
						driver: "dameng",
					},
				},
			}

			tx, err := dbInst.OpenTransactionExecer(context.Background())
			if err != nil {
				t.Fatalf("OpenTransactionExecer returned error: %v", err)
			}
			if _, err := tx.ExecContext(context.Background(), "UPDATE t SET v = 1"); err != nil {
				t.Fatalf("ExecContext returned error: %v", err)
			}
			if err := tc.finish(tx); err != nil {
				t.Fatalf("finish transaction returned error: %v", err)
			}
			if err := tx.Close(); err != nil {
				t.Fatalf("Close returned error: %v", err)
			}

			requests := stdin.String()
			for _, fragment := range []string{
				`"method":"openTransaction"`,
				`"method":"exec","sessionId":"transaction-1"`,
				`"method":"` + tc.finishMethod + `","sessionId":"transaction-1"`,
				`"method":"closeSession","sessionId":"transaction-1"`,
			} {
				if !strings.Contains(requests, fragment) {
					t.Fatalf("expected request fragment %q, got %s", fragment, requests)
				}
			}
		})
	}
}
