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

// initialize 执行 schema 迁移。user_version 高于已知版本时拒绝打开，
// 避免旧代码写入不认识的新 schema。
func (c *Catalog) initialize(ctx context.Context) error {
	var version int
	if err := c.db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("read session assets catalog version: %w", err)
	}
	if version > catalogSchemaVersion {
		return fmt.Errorf("session assets catalog version %d is newer than supported %d", version, catalogSchemaVersion)
	}
	for v := version; v < catalogSchemaVersion; v++ {
		if err := c.applyMigration(ctx, v+1); err != nil {
			return err
		}
	}
	return nil
}

// applyMigration 在单个事务内应用一个版本并推进 user_version。
func (c *Catalog) applyMigration(ctx context.Context, target int) error {
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin session assets migration %d: %w", target, err)
	}
	defer func() { _ = tx.Rollback() }()
	statements, ok := catalogMigrations[target]
	if !ok {
		return fmt.Errorf("missing session assets migration for version %d", target)
	}
	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("apply session assets migration %d: %w", target, err)
		}
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`PRAGMA user_version = %d`, target)); err != nil {
		return fmt.Errorf("record session assets migration %d: %w", target, err)
	}
	return tx.Commit()
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
