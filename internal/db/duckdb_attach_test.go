//go:build gonavi_full_drivers || gonavi_duckdb_driver

package db

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// newDuckDBAttachTestInstance 打开一个 :memory: DuckDB 实例作为附加宿主。
func newDuckDBAttachTestInstance(t *testing.T) *DuckDB {
	t.Helper()
	conn, err := sql.Open("duckdb", ":memory:")
	if err != nil {
		t.Fatalf("open duckdb: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return &DuckDB{conn: conn}
}

// newDuckDBAttachTargetFile 创建一个带数据的 .duckdb 文件作为附加目标。
func newDuckDBAttachTargetFile(t *testing.T, table string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "target.duckdb")
	fileDB, err := sql.Open("duckdb", path)
	if err != nil {
		t.Fatalf("open target: %v", err)
	}
	if _, err := fileDB.ExecContext(context.Background(),
		"CREATE TABLE "+table+" (id INTEGER); INSERT INTO "+table+" VALUES (42);"); err != nil {
		t.Fatalf("seed target: %v", err)
	}
	if err := fileDB.Close(); err != nil {
		t.Fatalf("close target: %v", err)
	}
	return path
}

func TestDuckDBAttachExternalDuckDBFileRoundTrip(t *testing.T) {
	host := newDuckDBAttachTestInstance(t)
	targetPath := newDuckDBAttachTargetFile(t, "orders")
	ctx := context.Background()

	spec := ExternalAttachSpec{
		Kind: ExternalAttachKindDuckDB, FilePath: targetPath, Alias: "ext_db", ReadOnly: true,
	}
	if err := host.AttachExternalDatabase(ctx, spec); err != nil {
		t.Fatalf("attach: %v", err)
	}

	var count int
	if err := host.conn.QueryRowContext(ctx, "SELECT count(*) FROM ext_db.orders").Scan(&count); err != nil {
		t.Fatalf("cross query: %v", err)
	}
	if count != 1 {
		t.Fatalf("count = %d, want 1", count)
	}

	// 只读附加：写入远端被拒绝
	if _, err := host.conn.ExecContext(ctx, "INSERT INTO ext_db.orders VALUES (7)"); err == nil {
		t.Fatalf("write into read-only attach should fail")
	}

	// 卸载后查询失败，再次卸载幂等
	if err := host.DetachExternalDatabase(ctx, "ext_db"); err != nil {
		t.Fatalf("detach: %v", err)
	}
	if err := host.DetachExternalDatabase(ctx, "ext_db"); !errors.Is(err, ErrExternalAttachNotAttached) {
		t.Fatalf("second detach = %v, want ErrExternalAttachNotAttached", err)
	}
	if _, err := host.conn.QueryContext(ctx, "SELECT * FROM ext_db.orders"); err == nil {
		t.Fatalf("query after detach should fail")
	}
}

func TestDuckDBAttachReplaceAndConflictSemantics(t *testing.T) {
	host := newDuckDBAttachTestInstance(t)
	fileA := newDuckDBAttachTargetFile(t, "marker_a")
	fileB := newDuckDBAttachTargetFile(t, "marker_b")
	ctx := context.Background()

	specA := ExternalAttachSpec{Kind: ExternalAttachKindDuckDB, FilePath: fileA, Alias: "ext_db"}
	if err := host.AttachExternalDatabase(ctx, specA); err != nil {
		t.Fatalf("attach A: %v", err)
	}
	// 同源重跑：替换重建成功
	if err := host.AttachExternalDatabase(ctx, specA); err != nil {
		t.Fatalf("idempotent re-attach: %v", err)
	}
	// 换文件同别名：冲突报错
	specB := ExternalAttachSpec{Kind: ExternalAttachKindDuckDB, FilePath: fileB, Alias: "ext_db"}
	err := host.AttachExternalDatabase(ctx, specB)
	if err == nil || !strings.Contains(err.Error(), "ext_db") {
		t.Fatalf("conflict error = %v", err)
	}
	// 冲突后原附加仍可用
	var count int
	if err := host.conn.QueryRowContext(ctx, "SELECT count(*) FROM ext_db.marker_a").Scan(&count); err != nil {
		t.Fatalf("original attach broken after conflict: %v", err)
	}
}

func TestDuckDBAttachAliasValidation(t *testing.T) {
	host := newDuckDBAttachTestInstance(t)
	for _, alias := range []string{"1bad", "with space", "semi;colon"} {
		err := host.AttachExternalDatabase(context.Background(), ExternalAttachSpec{
			Kind: ExternalAttachKindDuckDB, FilePath: "x.duckdb", Alias: alias,
		})
		if err == nil || !strings.Contains(err.Error(), alias) {
			t.Fatalf("alias %q: err = %v", alias, err)
		}
	}
}

// TestDuckDBAttachMySQLSecretSyntaxAndErrorSanitization 需要联网安装 mysql 扩展；
// 扩展不可用时跳过（与 duckdb_metadata_integration_test 的门控模式一致）。
// 通过“附加到不可达主机”验证：SECRET 语法被引擎接受、ATTACH 失败错误不含密码、
// 失败后无残留 SECRET。
func TestDuckDBAttachMySQLSecretSyntaxAndErrorSanitization(t *testing.T) {
	host := newDuckDBAttachTestInstance(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := host.ensureExtensionLoaded(ctx, "mysql"); err != nil {
		t.Skipf("mysql extension unavailable: %v", err)
	}

	const password = "s3cret-DO-NOT-LEAK"
	err := host.AttachExternalDatabase(ctx, ExternalAttachSpec{
		Kind: ExternalAttachKindMySQL, Host: "127.0.0.1", Port: 1,
		User: "gonavi-test", Password: password, Database: "no_such_db",
		Alias: "mysql_ext", ReadOnly: true,
	})
	if err == nil {
		t.Skipf("127.0.0.1:1 unexpectedly accepted a mysql connection; cannot exercise failure path")
	}
	if strings.Contains(err.Error(), password) {
		t.Fatalf("attach error leaked password: %v", err)
	}
	var secretCount int
	if err := host.conn.QueryRowContext(ctx,
		"SELECT count(*) FROM duckdb_secrets() WHERE name = 'gonavi_attach_mysql_ext'").Scan(&secretCount); err != nil {
		t.Fatalf("query secrets: %v", err)
	}
	if secretCount != 0 {
		t.Fatalf("failed attach left %d dangling secret(s)", secretCount)
	}
}
