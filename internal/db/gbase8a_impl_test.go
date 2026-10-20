//go:build gonavi_full_drivers || gonavi_gbase8a_driver

package db

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"

	"github.com/go-sql-driver/mysql"
)

// fakeGBaseConn 记录执行过的文本语句，failOn 中的语句返回错误。
type fakeGBaseConn struct {
	executed []string
	failOn   map[string]error
	valid    bool
}

func (c *fakeGBaseConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("not used") }
func (c *fakeGBaseConn) Close() error                        { return nil }
func (c *fakeGBaseConn) Begin() (driver.Tx, error) {
	return nil, errors.New("START TRANSACTION must not be used")
}
func (c *fakeGBaseConn) IsValid() bool { return c.valid }

func (c *fakeGBaseConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.executed = append(c.executed, query)
	if err := c.failOn[query]; err != nil {
		return nil, err
	}
	return driver.RowsAffected(0), nil
}

func TestGBase8aTransactionsUseAutocommit(t *testing.T) {
	inner := &fakeGBaseConn{valid: true}
	conn := &gbase8aConn{inner: inner}
	tx, err := conn.BeginTx(context.Background(), driver.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	tx, _ = conn.BeginTx(context.Background(), driver.TxOptions{})
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	want := "SET autocommit=0|COMMIT|SET autocommit=1|SET autocommit=0|ROLLBACK|SET autocommit=1"
	if got := strings.Join(inner.executed, "|"); got != want {
		t.Fatalf("executed %s, want %s", got, want)
	}
	if !conn.IsValid() || conn.ResetSession(context.Background()) != nil {
		t.Fatal("a connection with autocommit restored must stay in the pool")
	}
}

func TestGBase8aConnectionWithoutAutocommitLeavesPool(t *testing.T) {
	commitErr := errors.New("commit failed")
	inner := &fakeGBaseConn{valid: true, failOn: map[string]error{"COMMIT": commitErr, "SET autocommit=1": errors.New("broken pipe")}}
	conn := &gbase8aConn{inner: inner}
	tx, _ := conn.BeginTx(context.Background(), driver.TxOptions{})
	if err := tx.Commit(); !errors.Is(err, commitErr) {
		t.Fatalf("commit error must surface, got %v", err)
	}
	if conn.IsValid() || !errors.Is(conn.ResetSession(context.Background()), driver.ErrBadConn) {
		t.Fatal("a connection whose autocommit could not be restored must be discarded")
	}
	inner2 := &fakeGBaseConn{valid: true, failOn: map[string]error{"SET autocommit=0": errors.New("denied")}}
	if _, err := (&gbase8aConn{inner: inner2}).BeginTx(context.Background(), driver.TxOptions{}); err == nil {
		t.Fatal("begin must fail when autocommit cannot be turned off")
	}
}

func TestParseGBase8aVersion(t *testing.T) {
	for banner, want := range map[string]string{
		"8.6.2.43-R7-free.110605": "8.6.2.43",
		"9.5.3.27.126351":         "9.5.3.27.126351",
		" 9.5.2 ":                 "9.5.2",
		"GBase":                   "",
	} {
		if got := parseGBase8aVersion(banner); got != want {
			t.Fatalf("parseGBase8aVersion(%q) = %q, want %q", banner, got, want)
		}
	}
}

// gbase8aClusterDSN 构造与 openPool 实际形状一致的连接串（指向 GBase 8a 集群）。
func gbase8aClusterDSN(extra string) string {
	query := "charset=utf8mb4,utf8&loc=Local&multiStatements=true&parseTime=True&timeout=10s&tls=false"
	if extra != "" {
		query += "&" + extra
	}
	return "root:root@tcp(10.0.0.5:5258)/sales?" + query
}

// TestGBase8aForceInterpolateParams 锁定「连接串必须开启客户端参数内联」这个前提：集群把带占位符的
// 预处理语句下推 gnode 时不会绑定参数，关掉内联，结果集网格提交就会带回 1709 语法错误。
func TestGBase8aForceInterpolateParams(t *testing.T) {
	for name, testCase := range map[string]struct {
		dsn     string
		keepDSN bool
	}{
		"默认未设置时强制开启":   {dsn: gbase8aClusterDSN("")},
		"用户显式 false 也被覆盖": {dsn: gbase8aClusterDSN("interpolateParams=false")},
		"已开启时原样返回":     {dsn: gbase8aClusterDSN("interpolateParams=true"), keepDSN: true},
	} {
		t.Run(name, func(t *testing.T) {
			got, err := gbase8aForceInterpolateParams(testCase.dsn)
			if err != nil {
				t.Fatalf("gbase8aForceInterpolateParams: %v", err)
			}
			if testCase.keepDSN && got != testCase.dsn {
				t.Fatalf("已开启内联的连接串应原样返回，实际 %q", got)
			}
			parsed, err := mysql.ParseDSN(got)
			if err != nil {
				t.Fatalf("改写后的连接串无法解析：%v", err)
			}
			if !parsed.InterpolateParams {
				t.Fatalf("interpolateParams 必须为 true，实际连接串 %q", got)
			}
			if !parsed.MultiStatements || !parsed.ParseTime || parsed.Loc.String() != "Local" {
				t.Fatalf("改写不能丢连接参数：%+v", parsed)
			}
			if parsed.User != "root" || parsed.Passwd != "root" || parsed.DBName != "sales" || parsed.Addr != "10.0.0.5:5258" {
				t.Fatalf("改写不能丢连接身份：%+v", parsed)
			}
		})
	}
}

func TestGBase8aForceInterpolateParamsRejectsBrokenDSN(t *testing.T) {
	_, err := gbase8aForceInterpolateParams("not-a-dsn")
	if err == nil {
		t.Fatal("连接串无法解析时必须报错，而不是静默丢掉该参数")
	}
	// 文案必须来自 i18n 目录（localizedDatabaseRuntimeError），不能是硬编码字符串。
	prefix := localizedDriverRuntimeText("db.backend.error.gbase8a_dsn_parse_failed", map[string]any{"detail": ""})
	if !strings.HasPrefix(err.Error(), prefix) {
		t.Fatalf("错误文案必须走 i18n 目录，实际 %q，期望以 %q 开头", err.Error(), prefix)
	}
}

// TestGBase8aMergedWritesBindEveryPlaceholder 保证合成语句里 ? 的数量与参数数量严格相等：
// 驱动只在两者相等时才做客户端内联，不等会退回服务端预处理，集群下推 gnode 时又会丢参数。
func TestGBase8aMergedWritesBindEveryPlaceholder(t *testing.T) {
	for name, updates := range map[string][]connection.UpdateRow{
		"单行单列": {{Keys: map[string]interface{}{"id": 1}, Values: map[string]interface{}{"customer": "alice2"}}},
		"多行多列": {
			{Keys: map[string]interface{}{"id": 1}, Values: map[string]interface{}{"customer": "a", "amount": "1.50"}},
			{Keys: map[string]interface{}{"id": 3}, Values: map[string]interface{}{"amount": "33.30", "created": "2026-02-01 08:00:00"}},
		},
		"复合主键": {
			{Keys: map[string]interface{}{"id": 1, "tenant": "t1"}, Values: map[string]interface{}{"customer": "a"}},
			{Keys: map[string]interface{}{"id": 2, "tenant": "t2"}, Values: map[string]interface{}{"customer": "b"}},
		},
		"各行改的列不同": {
			{Keys: map[string]interface{}{"id": 1}, Values: map[string]interface{}{"customer": "a", "amount": "1.00"}},
			{Keys: map[string]interface{}{"id": 2}, Values: map[string]interface{}{"amount": "2.00"}},
			{Keys: map[string]interface{}{"id": 3}, Values: map[string]interface{}{"customer": "c"}},
		},
	} {
		t.Run(name, func(t *testing.T) {
			query, args, err := buildGBase8aUpdate("orders", updates, map[string]string{})
			if err != nil {
				t.Fatalf("buildGBase8aUpdate: %v", err)
			}
			if got := strings.Count(query, "?"); got != len(args) {
				t.Fatalf("占位符 %d 个、参数 %d 个，驱动会退回预处理：%s", got, len(args), query)
			}
		})
	}

	deletes := []map[string]interface{}{{"id": 1}, {"id": 2, "tenant": "t2"}}
	query, args := buildGBase8aDelete("orders", deletes, map[string]string{})
	if got := strings.Count(query, "?"); got != len(args) {
		t.Fatalf("占位符 %d 个、参数 %d 个，驱动会退回预处理：%s", got, len(args), query)
	}
}
