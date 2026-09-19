//go:build gonavi_full_drivers || gonavi_duckdb_driver

package db

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// ensureAttachState 惰性初始化附加映射；必须在 attachMu 持有后调用
// （锁本身是值类型，零值即可用，避免惰性初始化自身的竞态）。
func (d *DuckDB) ensureAttachState() {
	if d.attachments == nil {
		d.attachments = map[string]duckDBAttachmentSpec{}
	}
	if d.loadedExtensions == nil {
		d.loadedExtensions = map[string]bool{}
	}
}

// AttachExternalDatabase 实现 ExternalDatabaseAttacher：把外部数据源以
// DuckDB 原生 SECRET + ATTACH 挂到当前实例。附加关系随连接关闭消失。
func (d *DuckDB) AttachExternalDatabase(ctx context.Context, spec ExternalAttachSpec) error {
	if d.conn == nil {
		return duckDBConnectionNotOpenError()
	}
	if !duckDBAttachAliasPattern.MatchString(spec.Alias) {
		return duckDBRuntimeError("db.backend.error.duckdb_attach.alias_invalid", map[string]any{"alias": spec.Alias})
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	d.attachMu.Lock()
	defer d.attachMu.Unlock()
	d.ensureAttachState()

	desired := duckDBAttachmentSpec{
		kind:     spec.Kind,
		host:     spec.Host,
		port:     spec.Port,
		user:     spec.User,
		password: spec.Password,
		database: spec.Database,
		filePath: spec.FilePath,
		readOnly: spec.ReadOnly,
	}
	if existing, ok := d.attachments[spec.Alias]; ok {
		if existing != desired {
			// 别名被不同数据源占用：拒绝，防误绑；同源重跑走下面的替换语义
			return duckDBRuntimeError("db.backend.error.duckdb_attach.alias_occupied", map[string]any{"alias": spec.Alias})
		}
		// 同源重复执行（保存文件重跑）：卸旧重建，绑定当前最新凭据；
		// 附加关系已被原生 DETACH 移除时视为无需卸载，直接重建
		if err := d.detachLocked(ctx, spec.Alias); err != nil && !errors.Is(err, ErrExternalAttachNotAttached) {
			return err
		}
	}
	return d.attachLocked(ctx, spec, desired)
}

// DetachExternalDatabase 实现 ExternalDatabaseAttacher；未附加时返回
// ErrExternalAttachNotAttached，由调用方映射为幂等提示。
func (d *DuckDB) DetachExternalDatabase(ctx context.Context, alias string) error {
	if d.conn == nil {
		return duckDBConnectionNotOpenError()
	}
	if !duckDBAttachAliasPattern.MatchString(alias) {
		return duckDBRuntimeError("db.backend.error.duckdb_attach.alias_invalid", map[string]any{"alias": alias})
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	d.attachMu.Lock()
	defer d.attachMu.Unlock()
	d.ensureAttachState()
	return d.detachLocked(ctx, alias)
}

func (d *DuckDB) attachLocked(ctx context.Context, spec ExternalAttachSpec, desired duckDBAttachmentSpec) error {
	switch spec.Kind {
	case ExternalAttachKindMySQL, ExternalAttachKindPostgres:
		if err := d.ensureExtensionLoaded(ctx, spec.Kind); err != nil {
			return err
		}
		if err := d.createExternalSecret(ctx, spec); err != nil {
			return err
		}
		if err := d.execAttach(ctx, spec); err != nil {
			// SECRET 已建但 ATTACH 失败：清理会话级 SECRET，不留悬挂凭据
			d.dropExternalSecret(ctx, spec.SecretName)
			return err
		}
		d.attachments[spec.Alias] = desired
		return nil
	case ExternalAttachKindSQLite:
		if err := d.ensureExtensionLoaded(ctx, "sqlite_scanner"); err != nil {
			return err
		}
		if err := d.execAttach(ctx, spec); err != nil {
			return err
		}
		d.attachments[spec.Alias] = desired
		return nil
	case ExternalAttachKindDuckDB:
		if err := d.execAttach(ctx, spec); err != nil {
			return err
		}
		d.attachments[spec.Alias] = desired
		return nil
	default:
		return duckDBRuntimeError("db.backend.error.duckdb_attach.type_unsupported", map[string]any{
			"name": spec.Alias, "type": spec.Kind,
		})
	}
}

func (d *DuckDB) detachLocked(ctx context.Context, alias string) error {
	attached, err := d.aliasAttached(ctx, alias)
	if err != nil {
		return err
	}
	if !attached {
		return ErrExternalAttachNotAttached
	}
	if _, err := d.conn.ExecContext(ctx, "DETACH "+alias); err != nil {
		return duckDBWrapAttachEngineError(err, "")
	}
	// 会话级 SECRET 跟随连接实例消失；此处尽力清理，失败不阻断卸载
	d.dropExternalSecret(ctx, "gonavi_attach_"+alias)
	delete(d.attachments, alias)
	return nil
}

func (d *DuckDB) execAttach(ctx context.Context, spec ExternalAttachSpec) error {
	if _, err := d.conn.ExecContext(ctx, buildDuckDBAttachStatement(spec)); err != nil {
		return duckDBWrapAttachEngineError(err, spec.Password)
	}
	return nil
}

func (d *DuckDB) createExternalSecret(ctx context.Context, spec ExternalAttachSpec) error {
	var statement string
	switch spec.Kind {
	case ExternalAttachKindMySQL:
		statement = fmt.Sprintf("CREATE SECRET %s (TYPE MYSQL, HOST %s, PORT %d, USER %s, PASSWORD %s)",
			spec.SecretName, quoteDuckDBStringLiteral(spec.Host), spec.Port,
			quoteDuckDBStringLiteral(spec.User), quoteDuckDBStringLiteral(spec.Password))
	case ExternalAttachKindPostgres:
		statement = fmt.Sprintf("CREATE SECRET %s (TYPE POSTGRES, HOST %s, PORT %d, USER %s, PASSWORD %s, DATABASE %s)",
			spec.SecretName, quoteDuckDBStringLiteral(spec.Host), spec.Port,
			quoteDuckDBStringLiteral(spec.User), quoteDuckDBStringLiteral(spec.Password),
			quoteDuckDBStringLiteral(spec.Database))
	default:
		return nil
	}
	if _, err := d.conn.ExecContext(ctx, statement); err != nil {
		return duckDBWrapAttachEngineError(err, spec.Password)
	}
	return nil
}

// dropExternalSecret 尽力清理会话级 SECRET；失败不影响主流程（随连接关闭消亡）。
func (d *DuckDB) dropExternalSecret(ctx context.Context, secretName string) {
	_, _ = d.conn.ExecContext(ctx, "DROP SECRET IF EXISTS "+secretName)
}

// ensureExtensionLoaded 先 LOAD（幂等、离线可用），失败再 INSTALL（需联网）后重新
// LOAD；成功结果缓存在实例内，避免每条指令重复 LOAD。
func (d *DuckDB) ensureExtensionLoaded(ctx context.Context, extension string) error {
	if d.loadedExtensions[extension] {
		return nil
	}
	if _, err := d.conn.ExecContext(ctx, "LOAD "+extension); err == nil {
		d.loadedExtensions[extension] = true
		return nil
	}
	if _, err := d.conn.ExecContext(ctx, "INSTALL "+extension); err != nil {
		return duckDBRuntimeError("db.backend.error.duckdb_attach.extension_unavailable", map[string]any{
			"extension": extension, "detail": err.Error(),
		})
	}
	if _, err := d.conn.ExecContext(ctx, "LOAD "+extension); err != nil {
		return duckDBRuntimeError("db.backend.error.duckdb_attach.extension_unavailable", map[string]any{
			"extension": extension, "detail": err.Error(),
		})
	}
	d.loadedExtensions[extension] = true
	return nil
}

// aliasAttached 查询 duckdb_databases() 判断别名是否已附加（含非本驱动来源）。
func (d *DuckDB) aliasAttached(ctx context.Context, alias string) (bool, error) {
	var count int
	if err := d.conn.QueryRowContext(ctx,
		"SELECT count(*) FROM duckdb_databases() WHERE database_name = ?", alias).Scan(&count); err != nil {
		return false, duckDBWrapAttachEngineError(err, "")
	}
	return count > 0, nil
}

// duckDBWrapAttachEngineError 包装 DuckDB 引擎错误并脱敏密码；password 为空时仅包装。
func duckDBWrapAttachEngineError(err error, password string) error {
	if err == nil {
		return nil
	}
	detail := err.Error()
	if password != "" {
		// 引擎错误可能回显 SQL 片段：裸密码与字面量转义形式都脱敏
		detail = strings.ReplaceAll(detail, password, "***")
		detail = strings.ReplaceAll(detail, quoteDuckDBStringLiteral(password), "***")
	}
	return duckDBRuntimeError("db.backend.error.duckdb_attach.engine_failed", map[string]any{"detail": detail})
}

// 编译期守卫：DuckDB 实现可选接口。
var _ ExternalDatabaseAttacher = (*DuckDB)(nil)
