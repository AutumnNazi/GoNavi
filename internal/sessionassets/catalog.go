package sessionassets

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	_ "modernc.org/sqlite"
)

// catalogSchemaVersion 是 catalog.sqlite 的当前 schema 版本。迁移只向前，
// 版本高于本代码的库不得覆盖（V-13）。
const catalogSchemaVersion = 3

// Catalog 是材料库的 SQLite 索引：配置、来源、资产、任务与抑制标记。
// 表内容是可以由提交清单重建的投影加上不可重建的用户决定（启用、抑制）。
type Catalog struct {
	db   *sql.DB
	path string
}

// OpenCatalog 打开（必要时创建）材料库索引并执行向前迁移。
func OpenCatalog(path string) (*Catalog, error) {
	trimmed := path
	if trimmed == "" {
		return nil, errors.New("session assets catalog path is empty")
	}
	absolute, err := filepath.Abs(trimmed)
	if err != nil {
		return nil, fmt.Errorf("resolve session assets catalog path: %w", err)
	}
	if err := ensureDir(filepath.Dir(absolute)); err != nil {
		return nil, err
	}
	database, err := sql.Open("sqlite", catalogDSN(absolute))
	if err != nil {
		return nil, fmt.Errorf("open session assets catalog: %w", err)
	}
	// 材料库由进程级文件锁保证单写入者；连接池仅服务本进程内的并发查询。
	database.SetMaxOpenConns(4)
	database.SetMaxIdleConns(4)
	catalog := &Catalog{db: database, path: absolute}
	if err := catalog.initialize(context.Background()); err != nil {
		_ = database.Close()
		return nil, err
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		_ = database.Close()
		return nil, fmt.Errorf("secure session assets catalog: %w", err)
	}
	return catalog, nil
}

// Path 返回数据库文件路径。
func (c *Catalog) Path() string {
	if c == nil {
		return ""
	}
	return c.path
}

// Close 收尾 WAL 并关闭连接。调用方负责已持有材料库锁的释放。
func (c *Catalog) Close() error {
	if c == nil || c.db == nil {
		return nil
	}
	_, checkpointErr := c.db.ExecContext(context.Background(), `PRAGMA wal_checkpoint(TRUNCATE)`)
	closeErr := c.db.Close()
	c.db = nil
	return errors.Join(checkpointErr, closeErr)
}

// initialize 执行 schema 迁移。迁移在**单条连接**上进行，并在迁移期间
// 关闭外键：v3 的表重建含 DROP TABLE assets，外键开启会让引用它的
// source_refs/capture_jobs 被 ON DELETE CASCADE 清空（N3）。迁移只向前，
// 版本高于本代码的库不得覆盖（V-13）。
func (c *Catalog) initialize(ctx context.Context) error {
	var version int
	if err := c.db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("read session assets catalog version: %w", err)
	}
	if version > catalogSchemaVersion {
		return fmt.Errorf("session assets catalog version %d is newer than supported %d", version, catalogSchemaVersion)
	}
	if version >= catalogSchemaVersion {
		return nil
	}
	// 单连接独占迁移：PRAGMA foreign_keys 是连接级设置，事务内是空操作，
	// 必须在同一物理连接上以事务外方式切换。
	conn, err := c.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquire session assets migration connection: %w", err)
	}
	defer func() { _ = conn.Close() }()
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
		return fmt.Errorf("disable foreign keys for session assets migration: %w", err)
	}
	for v := version; v < catalogSchemaVersion; v++ {
		if err := applyMigrationOnConn(ctx, conn, v+1); err != nil {
			return err
		}
	}
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`); err != nil {
		return fmt.Errorf("restore foreign keys after session assets migration: %w", err)
	}
	return nil
}

// applyMigrationOnConn 在单连接手动事务内应用一个版本并推进 user_version。
func applyMigrationOnConn(ctx context.Context, conn *sql.Conn, target int) error {
	if _, err := conn.ExecContext(ctx, `BEGIN IMMEDIATE`); err != nil {
		return fmt.Errorf("begin session assets migration %d: %w", target, err)
	}
	statements, ok := catalogMigrations[target]
	if !ok {
		_, _ = conn.ExecContext(ctx, `ROLLBACK`)
		return fmt.Errorf("missing session assets migration for version %d", target)
	}
	for _, statement := range statements {
		if _, err := conn.ExecContext(ctx, statement); err != nil {
			_, _ = conn.ExecContext(ctx, `ROLLBACK`)
			return fmt.Errorf("apply session assets migration %d: %w", target, err)
		}
	}
	if _, err := conn.ExecContext(ctx, fmt.Sprintf(`PRAGMA user_version = %d`, target)); err != nil {
		_, _ = conn.ExecContext(ctx, `ROLLBACK`)
		return fmt.Errorf("record session assets migration %d: %w", target, err)
	}
	if _, err := conn.ExecContext(ctx, `COMMIT`); err != nil {
		return fmt.Errorf("commit session assets migration %d: %w", target, err)
	}
	return nil
}

// catalogDSN 构造带 PRAGMA 的 SQLite DSN，模式与 syncjob 保持一致；
// Windows 路径需要转斜杠并补全 file URI 的盘符前导斜杠。
func catalogDSN(path string) string {
	uriPath := filepath.ToSlash(path)
	dsn := &url.URL{Scheme: "file", Path: uriPath}
	if runtime.GOOS == "windows" {
		if strings.HasPrefix(uriPath, "//") {
			withoutPrefix := strings.TrimPrefix(uriPath, "//")
			if separator := strings.IndexByte(withoutPrefix, '/'); separator >= 0 {
				dsn.Host = withoutPrefix[:separator]
				dsn.Path = withoutPrefix[separator:]
			}
		} else if !strings.HasPrefix(uriPath, "/") {
			dsn.Path = "/" + uriPath
		}
	}
	query := url.Values{}
	for _, pragma := range []string{"busy_timeout(5000)", "foreign_keys(ON)", "synchronous(FULL)", "journal_mode(WAL)"} {
		query.Add("_pragma", pragma)
	}
	query.Set("_txlock", "immediate")
	dsn.RawQuery = query.Encode()
	return dsn.String()
}
