package sessionassets

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// SourceInput 是登记来源所需的字段。
type SourceInput struct {
	IntegrationID string
	Kind          string
	DisplayName   string
	RootPath      string
	IdentityKey   string
}

// UpsertSource 按 (integration, identity_key) 幂等登记历史来源：同目录
// 以别名再次加入返回已有来源而不重复注册（V-01）。冲突的身份不合并。
func (c *Catalog) UpsertSource(ctx context.Context, input SourceInput) (Source, error) {
	input.RootPath = strings.TrimSpace(input.RootPath)
	input.IdentityKey = strings.TrimSpace(input.IdentityKey)
	if input.IntegrationID == "" || input.RootPath == "" || input.IdentityKey == "" {
		return Source{}, fmt.Errorf("source integration, root path and identity key are required")
	}
	now := time.Now().Unix()
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return Source{}, fmt.Errorf("begin upsert source: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var existing Source
	scanErr := tx.QueryRowContext(ctx,
		`SELECT id, integration_id, kind, display_name, root_path, identity_key, enabled, last_checked_at, created_at, updated_at
		 FROM sources WHERE integration_id = ? AND identity_key = ?`,
		input.IntegrationID, input.IdentityKey,
	).Scan(&existing.ID, &existing.IntegrationID, &existing.Kind, &existing.DisplayName, &existing.RootPath, &existing.IdentityKey, &existing.Enabled, &existing.LastCheckedAt, &existing.CreatedAt, &existing.UpdatedAt)
	switch {
	case scanErr == nil:
		if err := tx.Commit(); err != nil {
			return Source{}, fmt.Errorf("commit upsert source lookup: %w", err)
		}
		return existing, nil
	case !errors.Is(scanErr, sql.ErrNoRows):
		return Source{}, fmt.Errorf("scan existing source: %w", scanErr)
	}
	id, err := newID()
	if err != nil {
		return Source{}, err
	}
	source := Source{
		ID: id, IntegrationID: input.IntegrationID, Kind: input.Kind,
		DisplayName: input.DisplayName, RootPath: input.RootPath, IdentityKey: input.IdentityKey,
		Enabled: true, CreatedAt: now, UpdatedAt: now,
	}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO sources (id, integration_id, kind, display_name, root_path, identity_key, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
		source.ID, source.IntegrationID, source.Kind, source.DisplayName, source.RootPath, source.IdentityKey, source.CreatedAt, source.UpdatedAt,
	)
	if err != nil {
		return Source{}, fmt.Errorf("insert source: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Source{}, fmt.Errorf("commit upsert source: %w", err)
	}
	return source, nil
}

// GetSource 按 ID 读取来源。
func (c *Catalog) GetSource(ctx context.Context, id string) (Source, error) {
	row := c.db.QueryRowContext(ctx, sourceSelect+` WHERE id = ?`, id)
	return scanSource(row)
}

// ListSources 返回集成下的全部来源。
func (c *Catalog) ListSources(ctx context.Context, integrationID string) ([]Source, error) {
	rows, err := c.db.QueryContext(ctx, sourceSelect+` WHERE integration_id = ? ORDER BY created_at ASC`, integrationID)
	if err != nil {
		return nil, fmt.Errorf("list sources: %w", err)
	}
	defer rows.Close()
	sources := make([]Source, 0)
	for rows.Next() {
		source, err := scanSource(rows)
		if err != nil {
			return nil, err
		}
		sources = append(sources, source)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sources: %w", err)
	}
	return sources, nil
}

// SetSourceEnabled 停用或恢复单个来源；停用只停止该来源的采集。
func (c *Catalog) SetSourceEnabled(ctx context.Context, id string, enabled bool) error {
	result, err := c.db.ExecContext(ctx,
		`UPDATE sources SET enabled = ?, updated_at = ? WHERE id = ?`,
		boolToInt(enabled), time.Now().Unix(), id)
	if err != nil {
		return fmt.Errorf("update source enabled: %w", err)
	}
	if rows, err := result.RowsAffected(); err == nil && rows == 0 {
		return ErrNotFound
	}
	return nil
}

// MarkSourceChecked 更新来源最近核对时间与可选的显示名。
func (c *Catalog) MarkSourceChecked(ctx context.Context, id string, displayName string) error {
	result, err := c.db.ExecContext(ctx,
		`UPDATE sources SET last_checked_at = ?,
		 display_name = CASE WHEN ? <> '' THEN ? ELSE display_name END,
		 updated_at = ? WHERE id = ?`,
		time.Now().Unix(), displayName, displayName, time.Now().Unix(), id)
	if err != nil {
		return fmt.Errorf("mark source checked: %w", err)
	}
	if rows, err := result.RowsAffected(); err == nil && rows == 0 {
		return ErrNotFound
	}
	return nil
}

const sourceSelect = `SELECT id, integration_id, kind, display_name, root_path, identity_key, enabled, last_checked_at, created_at, updated_at FROM sources`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSource(scanner rowScanner) (Source, error) {
	var source Source
	var enabled int
	err := scanner.Scan(&source.ID, &source.IntegrationID, &source.Kind, &source.DisplayName, &source.RootPath, &source.IdentityKey, &enabled, &source.LastCheckedAt, &source.CreatedAt, &source.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Source{}, ErrNotFound
	}
	if err != nil {
		return Source{}, fmt.Errorf("scan source: %w", err)
	}
	source.Enabled = enabled != 0
	return source, nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
