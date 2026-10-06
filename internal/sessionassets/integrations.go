package sessionassets

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// EnableIntegration 启用一种智能体工具。同工具重复启用是幂等操作：返回
// 已有记录而不创建第二个入口（S-04）；唯一约束是最终保证。
func (c *Catalog) EnableIntegration(ctx context.Context, kind AgentKind, displayName string) (Integration, error) {
	kind = normalizeKind(kind)
	if kind == "" {
		return Integration{}, fmt.Errorf("agent kind is empty")
	}
	now := time.Now().Unix()
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return Integration{}, fmt.Errorf("begin enable integration: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var existing Integration
	scanErr := tx.QueryRowContext(ctx,
		`SELECT id, kind, display_name, enabled, created_at, updated_at
		 FROM integrations WHERE kind = ?`, string(kind),
	).Scan(&existing.ID, &existing.Kind, &existing.DisplayName, &existing.Enabled, &existing.CreatedAt, &existing.UpdatedAt)
	switch {
	case scanErr == nil:
		if err := tx.Commit(); err != nil {
			return Integration{}, fmt.Errorf("commit enable integration lookup: %w", err)
		}
		return existing, nil
	case !errors.Is(scanErr, sql.ErrNoRows):
		return Integration{}, fmt.Errorf("scan existing integration: %w", scanErr)
	}
	id, err := newID()
	if err != nil {
		return Integration{}, err
	}
	integration := Integration{ID: id, Kind: string(kind), DisplayName: displayName, Enabled: true, CreatedAt: now, UpdatedAt: now}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO integrations (id, kind, display_name, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, 1, ?, ?)`,
		integration.ID, integration.Kind, integration.DisplayName, integration.CreatedAt, integration.UpdatedAt,
	)
	if err != nil {
		return Integration{}, fmt.Errorf("insert integration: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Integration{}, fmt.Errorf("commit enable integration: %w", err)
	}
	return integration, nil
}

// GetIntegration 按 ID 读取集成记录。
func (c *Catalog) GetIntegration(ctx context.Context, id string) (Integration, error) {
	row := c.db.QueryRowContext(ctx,
		`SELECT id, kind, display_name, enabled, created_at, updated_at
		 FROM integrations WHERE id = ?`, id)
	var integration Integration
	err := row.Scan(&integration.ID, &integration.Kind, &integration.DisplayName, &integration.Enabled, &integration.CreatedAt, &integration.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Integration{}, ErrNotFound
	}
	if err != nil {
		return Integration{}, fmt.Errorf("scan integration: %w", err)
	}
	return integration, nil
}

// ListIntegrations 返回全部集成记录，按启用与创建时间排序。
func (c *Catalog) ListIntegrations(ctx context.Context) ([]Integration, error) {
	rows, err := c.db.QueryContext(ctx,
		`SELECT id, kind, display_name, enabled, created_at, updated_at
		 FROM integrations ORDER BY enabled DESC, created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list integrations: %w", err)
	}
	defer rows.Close()
	integrations := make([]Integration, 0)
	for rows.Next() {
		var integration Integration
		if err := rows.Scan(&integration.ID, &integration.Kind, &integration.DisplayName, &integration.Enabled, &integration.CreatedAt, &integration.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan integration: %w", err)
		}
		integrations = append(integrations, integration)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate integrations: %w", err)
	}
	return integrations, nil
}

// SetIntegrationEnabled 切换启用状态。禁用保留配置与资产（S-06），
// 只停止后续采集。
func (c *Catalog) SetIntegrationEnabled(ctx context.Context, id string, enabled bool) error {
	result, err := c.db.ExecContext(ctx,
		`UPDATE integrations SET enabled = ?, updated_at = ? WHERE id = ?`,
		boolToInt(enabled), time.Now().Unix(), id)
	if err != nil {
		return fmt.Errorf("update integration enabled: %w", err)
	}
	if rows, err := result.RowsAffected(); err == nil && rows == 0 {
		return ErrNotFound
	}
	return nil
}

// normalizeKind 统一工具类型的空白；kind 常量本身全小写。
func normalizeKind(kind AgentKind) AgentKind {
	return AgentKind(strings.TrimSpace(string(kind)))
}

// IntegrationEnabledByID 按集成 ID 查询启用状态；记录不存在时返回 false。
func (c *Catalog) IntegrationEnabledByID(ctx context.Context, id string) (bool, error) {
	var enabled int
	err := c.db.QueryRowContext(ctx,
		`SELECT enabled FROM integrations WHERE id = ?`, id).Scan(&enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("query integration enabled: %w", err)
	}
	return enabled != 0, nil
}

// IntegrationEnabledByIDForAsset 通过资产 ID 查其所属集成的启用状态；
// 资产不存在时返回 false（不可重试）。
func (c *Catalog) IntegrationEnabledByIDForAsset(ctx context.Context, assetID string) (bool, error) {
	var enabled int
	err := c.db.QueryRowContext(ctx,
		`SELECT i.enabled FROM integrations i JOIN assets a ON a.integration_id = i.id WHERE a.id = ? AND a.deleted = 0`,
		assetID).Scan(&enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("query integration enabled for asset: %w", err)
	}
	return enabled != 0, nil
}
