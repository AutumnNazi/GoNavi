package sessionassets

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// AssetInput 是发现流程上报的资产元数据。除 ID 类字段外都允许未知
// （空值），不从文件名猜测缺失字段（需求 §4.2）。
type AssetInput struct {
	IntegrationID  string
	NativeThreadID string
	// 首次纳入来源的身份键：跨来源同 ID 保留独立资产，不无条件合并（P0-06）。
	OriginIdentityKey string
	SourceID          string
	NativePath        string
	SourceStatus      SourceStatus
	// 上次观测的源文件版本，写入 source_refs 供重归档比较（P0-03）。
	SourceSize         int64
	SourceModTime      int64
	Title              string
	ProjectDir         string
	Provider           string
	Model              string
	CreatedAt          int64
	UpdatedAt          int64
	ForkParentThreadID string
}

// UpsertAsset 幂等纳入一个会话资产：同一来源身份内相同 native_thread_id
// 合并为同一资产并补充来源引用；跨来源相同 ID 保留独立资产，不无条件
// 合并（P0-06/V-01）。用户删除过的身份返回 ErrSuppressed，禁止扫描自动
// 重新纳入（FR-20）。元数据只被更新的观测覆盖，不被空值抹掉。
func (c *Catalog) UpsertAsset(ctx context.Context, input AssetInput) (Asset, error) {
	input.NativeThreadID = strings.TrimSpace(input.NativeThreadID)
	input.IntegrationID = strings.TrimSpace(input.IntegrationID)
	input.OriginIdentityKey = strings.TrimSpace(input.OriginIdentityKey)
	if input.IntegrationID == "" || input.NativeThreadID == "" {
		return Asset{}, fmt.Errorf("asset integration and native thread id are required")
	}
	if input.SourceStatus == "" {
		input.SourceStatus = SourceStatusUnknown
	}
	now := time.Now().Unix()
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return Asset{}, fmt.Errorf("begin upsert asset: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	suppressed, err := checkSuppressedTx(ctx, tx, input.IntegrationID, input.OriginIdentityKey, input.NativeThreadID)
	if err != nil {
		return Asset{}, err
	}
	if suppressed {
		return Asset{}, ErrSuppressed
	}
	var asset Asset
	err = tx.QueryRowContext(ctx, assetSelect+` WHERE integration_id = ? AND origin_identity_key = ? AND native_thread_id = ? AND deleted = 0`,
		input.IntegrationID, input.OriginIdentityKey, input.NativeThreadID).Scan(asset.scanDest()...)
	switch {
	case err == nil:
		if err := updateAssetMetadataTx(ctx, tx, &asset, input, now); err != nil {
			return Asset{}, err
		}
	case errors.Is(err, sql.ErrNoRows):
		asset, err = insertAssetTx(ctx, tx, input, now)
		if err != nil {
			return Asset{}, err
		}
	default:
		return Asset{}, fmt.Errorf("scan existing asset: %w", err)
	}
	if input.SourceID != "" {
		if err := upsertSourceRefTx(ctx, tx, asset.ID, input, now); err != nil {
			return Asset{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Asset{}, fmt.Errorf("commit upsert asset: %w", err)
	}
	return asset, nil
}

func insertAssetTx(ctx context.Context, tx *sql.Tx, input AssetInput, now int64) (Asset, error) {
	id, err := newID()
	if err != nil {
		return Asset{}, err
	}
	sessionCreated := input.CreatedAt
	if sessionCreated == 0 {
		sessionCreated = now
	}
	sessionUpdated := input.UpdatedAt
	if sessionUpdated == 0 {
		sessionUpdated = sessionCreated
	}
	asset := Asset{
		ID: id, IntegrationID: input.IntegrationID, OriginIdentityKey: input.OriginIdentityKey, NativeThreadID: input.NativeThreadID,
		Title: input.Title, ProjectDir: input.ProjectDir, Provider: input.Provider, Model: input.Model,
		CreatedAt: sessionCreated, UpdatedAt: sessionUpdated,
		FirstSeenAt: now, LastSeenAt: now, ForkParentThreadID: input.ForkParentThreadID,
		BackupStatus: string(BackupStatusNone), MaterialStatus: string(MaterialStatusNotPrepared),
	}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO assets (id, integration_id, origin_identity_key, native_thread_id, title, project_dir, provider, model,
		   created_at, updated_at, first_seen_at, last_seen_at, fork_parent_thread_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		asset.ID, asset.IntegrationID, asset.OriginIdentityKey, asset.NativeThreadID, asset.Title, asset.ProjectDir, asset.Provider, asset.Model,
		asset.CreatedAt, asset.UpdatedAt, asset.FirstSeenAt, asset.LastSeenAt, asset.ForkParentThreadID,
	)
	if err != nil {
		return Asset{}, fmt.Errorf("insert asset: %w", err)
	}
	return asset, nil
}

// updateAssetMetadataTx 用最新观测更新元数据；空值保留旧观测，时间只前进。
func updateAssetMetadataTx(ctx context.Context, tx *sql.Tx, asset *Asset, input AssetInput, now int64) error {
	if input.Title != "" {
		asset.Title = input.Title
	}
	if input.ProjectDir != "" {
		asset.ProjectDir = input.ProjectDir
	}
	if input.Provider != "" {
		asset.Provider = input.Provider
	}
	if input.Model != "" {
		asset.Model = input.Model
	}
	if input.ForkParentThreadID != "" {
		asset.ForkParentThreadID = input.ForkParentThreadID
	}
	if input.CreatedAt > 0 && (asset.CreatedAt == 0 || input.CreatedAt < asset.CreatedAt) {
		asset.CreatedAt = input.CreatedAt
	}
	if input.UpdatedAt > asset.UpdatedAt {
		asset.UpdatedAt = input.UpdatedAt
	}
	if asset.LastSeenAt < now {
		asset.LastSeenAt = now
	}
	_, err := tx.ExecContext(ctx,
		`UPDATE assets SET title = ?, project_dir = ?, provider = ?, model = ?,
		   created_at = ?, updated_at = ?, last_seen_at = ?, fork_parent_thread_id = ?
		 WHERE id = ?`,
		asset.Title, asset.ProjectDir, asset.Provider, asset.Model,
		asset.CreatedAt, asset.UpdatedAt, asset.LastSeenAt, asset.ForkParentThreadID, asset.ID,
	)
	if err != nil {
		return fmt.Errorf("update asset metadata: %w", err)
	}
	return nil
}

func upsertSourceRefTx(ctx context.Context, tx *sql.Tx, assetID string, input AssetInput, now int64) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO source_refs (asset_id, source_id, native_path, source_status, last_seen_at, source_size, source_mtime)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(asset_id, source_id) DO UPDATE SET
		   native_path = CASE WHEN ? <> '' THEN ? ELSE native_path END,
		   source_status = excluded.source_status,
		   last_seen_at = excluded.last_seen_at,
		   source_size = excluded.source_size,
		   source_mtime = excluded.source_mtime`,
		assetID, input.SourceID, input.NativePath, string(input.SourceStatus), now,
		input.SourceSize, input.SourceModTime,
		input.NativePath, input.NativePath,
	)
	if err != nil {
		return fmt.Errorf("upsert source ref: %w", err)
	}
	return nil
}

// GetAsset 按 ID 读取资产（不含已删除记录）。
func (c *Catalog) GetAsset(ctx context.Context, id string) (Asset, error) {
	row := c.db.QueryRowContext(ctx, assetSelect+` WHERE id = ? AND deleted = 0`, id)
	var asset Asset
	if err := row.Scan(asset.scanDest()...); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Asset{}, ErrNotFound
		}
		return Asset{}, fmt.Errorf("scan asset: %w", err)
	}
	return asset, nil
}

// ListAssets 返回集成下的全部资产（含各状态维度，默认视图不按来源状态
// 过滤——交互设计 §1）。
func (c *Catalog) ListAssets(ctx context.Context, integrationID string) ([]Asset, error) {
	rows, err := c.db.QueryContext(ctx, assetSelect+` WHERE integration_id = ? AND deleted = 0 ORDER BY updated_at DESC`, integrationID)
	if err != nil {
		return nil, fmt.Errorf("list assets: %w", err)
	}
	defer rows.Close()
	assets := make([]Asset, 0)
	for rows.Next() {
		var asset Asset
		if err := rows.Scan(asset.scanDest()...); err != nil {
			return nil, fmt.Errorf("scan asset: %w", err)
		}
		assets = append(assets, asset)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate assets: %w", err)
	}
	return assets, nil
}

// ListSourceRefs 返回资产的全部来源引用。
func (c *Catalog) ListSourceRefs(ctx context.Context, assetID string) ([]SourceRef, error) {
	rows, err := c.db.QueryContext(ctx,
		`SELECT asset_id, source_id, native_path, source_status, last_seen_at, source_size, source_mtime
		 FROM source_refs WHERE asset_id = ? ORDER BY last_seen_at DESC`, assetID)
	if err != nil {
		return nil, fmt.Errorf("list source refs: %w", err)
	}
	defer rows.Close()
	refs := make([]SourceRef, 0)
	for rows.Next() {
		var ref SourceRef
		if err := rows.Scan(&ref.AssetID, &ref.SourceID, &ref.NativePath, &ref.SourceStatus, &ref.LastSeenAt, &ref.SourceSize, &ref.SourceMtime); err != nil {
			return nil, fmt.Errorf("scan source ref: %w", err)
		}
		refs = append(refs, ref)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate source refs: %w", err)
	}
	return refs, nil
}

// UpdateAssetProjection 写入备份投影字段。reconcile 用提交清单重建这些值；
// 这里不做状态推导，推导在提交与核对逻辑中完成。
func (c *Catalog) UpdateAssetProjection(ctx context.Context, assetID string, backup BackupStatus, material MaterialStatus, generationID string, complete bool, backedUpAt int64) error {
	result, err := c.db.ExecContext(ctx,
		`UPDATE assets SET backup_status = ?, material_status = ?, latest_generation_id = ?,
		   latest_complete = ?, last_backup_at = ? WHERE id = ? AND deleted = 0`,
		string(backup), string(material), generationID, boolToInt(complete), backedUpAt, assetID)
	if err != nil {
		return fmt.Errorf("update asset projection: %w", err)
	}
	if rows, err := result.RowsAffected(); err == nil && rows == 0 {
		return ErrNotFound
	}
	return nil
}

const assetSelect = `SELECT id, integration_id, origin_identity_key, native_thread_id, title, project_dir, provider, model,
	created_at, updated_at, first_seen_at, last_seen_at, fork_parent_thread_id,
	backup_status, material_status, latest_generation_id, latest_complete, last_backup_at
	FROM assets`

func (a *Asset) scanDest() []any {
	return []any{
		&a.ID, &a.IntegrationID, &a.OriginIdentityKey, &a.NativeThreadID, &a.Title, &a.ProjectDir, &a.Provider, &a.Model,
		&a.CreatedAt, &a.UpdatedAt, &a.FirstSeenAt, &a.LastSeenAt, &a.ForkParentThreadID,
		&a.BackupStatus, &a.MaterialStatus, &a.LatestGenerationID, &a.LatestComplete, &a.LastBackupAt,
	}
}

// CountAssets 统计集成下的资产数量（主页分组节点徽标使用）。
func (c *Catalog) CountAssets(ctx context.Context, integrationID string) (int, error) {
	var count int
	err := c.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM assets WHERE integration_id = ? AND deleted = 0`, integrationID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count assets: %w", err)
	}
	return count, nil
}

// UpdateSourceRefStatus 更新资产在某来源下的观测状态（active/archived/
// deleted/unreachable/unknown）。来源消失的判定只改元数据维度。
func (c *Catalog) UpdateSourceRefStatus(ctx context.Context, assetID, sourceID string, status SourceStatus) error {
	result, err := c.db.ExecContext(ctx,
		`UPDATE source_refs SET source_status = ?, last_seen_at = ? WHERE asset_id = ? AND source_id = ?`,
		string(status), time.Now().Unix(), assetID, sourceID)
	if err != nil {
		return fmt.Errorf("update source ref status: %w", err)
	}
	if rows, err := result.RowsAffected(); err == nil && rows == 0 {
		return ErrNotFound
	}
	return nil
}

// FindSourceRef 读取资产在某来源下的当前引用（不存在时返回 ErrNotFound）。
func (c *Catalog) FindSourceRef(ctx context.Context, assetID, sourceID string) (SourceRef, error) {
	row := c.db.QueryRowContext(ctx,
		`SELECT asset_id, source_id, native_path, source_status, last_seen_at, source_size, source_mtime
		 FROM source_refs WHERE asset_id = ? AND source_id = ?`, assetID, sourceID)
	var ref SourceRef
	err := row.Scan(&ref.AssetID, &ref.SourceID, &ref.NativePath, &ref.SourceStatus, &ref.LastSeenAt, &ref.SourceSize, &ref.SourceMtime)
	if errors.Is(err, sql.ErrNoRows) {
		return SourceRef{}, ErrNotFound
	}
	if err != nil {
		return SourceRef{}, fmt.Errorf("find source ref: %w", err)
	}
	return ref, nil
}

// FindSourceRefByThread 按原生会话 ID 与来源查引用（发现流程在纳入前
// 读取旧状态使用）。
func (c *Catalog) FindSourceRefByThread(ctx context.Context, sourceID, nativeThreadID string) (SourceRef, error) {
	row := c.db.QueryRowContext(ctx,
		`SELECT r.asset_id, r.source_id, r.native_path, r.source_status, r.last_seen_at, r.source_size, r.source_mtime
		 FROM source_refs r JOIN assets a ON a.id = r.asset_id
		 WHERE r.source_id = ? AND a.native_thread_id = ? AND a.deleted = 0`,
		sourceID, nativeThreadID)
	var ref SourceRef
	err := row.Scan(&ref.AssetID, &ref.SourceID, &ref.NativePath, &ref.SourceStatus, &ref.LastSeenAt, &ref.SourceSize, &ref.SourceMtime)
	if errors.Is(err, sql.ErrNoRows) {
		return SourceRef{}, ErrNotFound
	}
	if err != nil {
		return SourceRef{}, fmt.Errorf("find source ref by thread: %w", err)
	}
	return ref, nil
}

// QueryAssets 按筛选条件分页查询资产列表：标题/项目/provider 基础检索、
// 来源状态维度筛选；按源更新时间倒序（备份时间不扰动排序，V-07）。
func (c *Catalog) QueryAssets(ctx context.Context, integrationID string, filter AssetFilter) ([]Asset, int, error) {
	where := []string{"integration_id = ?", "deleted = 0"}
	args := []any{integrationID}
	if trimmed := strings.TrimSpace(filter.Query); trimmed != "" {
		like := "%" + strings.ToLower(trimmed) + "%"
		where = append(where, "(LOWER(title) LIKE ? OR LOWER(project_dir) LIKE ? OR LOWER(provider) LIKE ?)")
		args = append(args, like, like, like)
	}
	if trimmed := strings.TrimSpace(filter.ProjectDir); trimmed != "" {
		where = append(where, "LOWER(project_dir) LIKE ?")
		args = append(args, "%"+strings.ToLower(trimmed)+"%")
	}
	if trimmed := strings.TrimSpace(filter.Provider); trimmed != "" {
		where = append(where, "LOWER(provider) = ?")
		args = append(args, strings.ToLower(trimmed))
	}
	if trimmed := strings.TrimSpace(filter.BackupStatus); trimmed != "" {
		where = append(where, "backup_status = ?")
		args = append(args, trimmed)
	}
	if trimmed := strings.TrimSpace(filter.SourceID); trimmed != "" {
		where = append(where, "EXISTS (SELECT 1 FROM source_refs sr WHERE sr.asset_id = assets.id AND sr.source_id = ?)")
		args = append(args, trimmed)
	}
	if trimmed := strings.TrimSpace(filter.SourceStatus); trimmed != "" {
		if trimmed == "unknown" {
			where = append(where, "NOT EXISTS (SELECT 1 FROM source_refs sr2 WHERE sr2.asset_id = assets.id AND sr2.source_status IN ('active','archived','deleted'))")
		} else {
			where = append(where, "EXISTS (SELECT 1 FROM source_refs sr3 WHERE sr3.asset_id = assets.id AND sr3.source_status = ?)")
			args = append(args, trimmed)
		}
	}
	whereClause := strings.Join(where, " AND ")

	var total int
	if err := c.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM assets WHERE `+whereClause, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count assets: %w", err)
	}
	page, size := normalizePage(filter.Page, filter.PageSize)
	args = append(args, size, (page-1)*size)
	rows, err := c.db.QueryContext(ctx, assetSelect+` WHERE `+whereClause+` ORDER BY updated_at DESC LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("query assets: %w", err)
	}
	defer rows.Close()
	assets := make([]Asset, 0, size)
	for rows.Next() {
		var asset Asset
		if err := rows.Scan(asset.scanDest()...); err != nil {
			return nil, 0, fmt.Errorf("scan asset: %w", err)
		}
		assets = append(assets, asset)
	}
	return assets, total, rows.Err()
}

func normalizePage(page, size int) (int, int) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 200 {
		size = 50
	}
	return page, size
}

// SourceStatusByAsset 聚合集成内每个资产的原记录状态展示值：
// active > archived > deleted > unknown（需求 §4.3 分维表达）。
func (c *Catalog) SourceStatusByAsset(ctx context.Context, integrationID string) (map[string]string, error) {
	rows, err := c.db.QueryContext(ctx,
		`SELECT r.asset_id,
		   CASE
		     WHEN SUM(CASE WHEN r.source_status = 'active' THEN 1 ELSE 0 END) > 0 THEN 'active'
		     WHEN SUM(CASE WHEN r.source_status = 'archived' THEN 1 ELSE 0 END) > 0 THEN 'archived'
		     WHEN SUM(CASE WHEN r.source_status = 'deleted' THEN 1 ELSE 0 END) > 0 THEN 'deleted'
		     ELSE 'unknown'
		   END AS aggregated
		 FROM source_refs r JOIN assets a ON a.id = r.asset_id
		 WHERE a.integration_id = ? AND a.deleted = 0
		 GROUP BY r.asset_id`, integrationID)
	if err != nil {
		return nil, fmt.Errorf("aggregate source status: %w", err)
	}
	defer rows.Close()
	result := make(map[string]string)
	for rows.Next() {
		var assetID, status string
		if err := rows.Scan(&assetID, &status); err != nil {
			return nil, fmt.Errorf("scan source status: %w", err)
		}
		result[assetID] = status
	}
	return result, rows.Err()
}

// MarkSourceRefsStatusForSource 把来源下全部引用置为同一状态（来源整体
// 不可达时使用；不触碰副本与资产本体）。
func (c *Catalog) MarkSourceRefsStatusForSource(ctx context.Context, sourceID string, status SourceStatus) error {
	_, err := c.db.ExecContext(ctx,
		`UPDATE source_refs SET source_status = ?, last_seen_at = ? WHERE source_id = ?`,
		string(status), time.Now().Unix(), sourceID)
	if err != nil {
		return fmt.Errorf("mark source refs: %w", err)
	}
	return nil
}
