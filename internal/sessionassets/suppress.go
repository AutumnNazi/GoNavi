package sessionassets

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// checkSuppressedTx 在事务内检查资产身份是否被用户删除抑制。
func checkSuppressedTx(ctx context.Context, tx *sql.Tx, integrationID, originIdentityKey, nativeThreadID string) (bool, error) {
	var one int
	err := tx.QueryRowContext(ctx,
		`SELECT 1 FROM suppressed_sources WHERE integration_id = ? AND origin_identity_key = ? AND native_thread_id = ?`,
		integrationID, originIdentityKey, nativeThreadID).Scan(&one)
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, sql.ErrNoRows):
		return false, nil
	default:
		return false, fmt.Errorf("check suppression: %w", err)
	}
}

// IsSuppressed 按身份检查抑制标记。被抑制的身份在显式“重新纳入”前，
// 扫描不得自动重新纳入（FR-20）。
func (c *Catalog) IsSuppressed(ctx context.Context, integrationID, originIdentityKey, nativeThreadID string) (bool, error) {
	var one int
	err := c.db.QueryRowContext(ctx,
		`SELECT 1 FROM suppressed_sources WHERE integration_id = ? AND origin_identity_key = ? AND native_thread_id = ?`,
		integrationID, originIdentityKey, nativeThreadID).Scan(&one)
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, sql.ErrNoRows):
		return false, nil
	default:
		return false, fmt.Errorf("check suppression: %w", err)
	}
}

// IsSuppressedByAsset 按资产 ID 检查抑制标记（提交落点前的最终校验）。
func (c *Catalog) IsSuppressedByAsset(ctx context.Context, assetID string) (bool, error) {
	asset, err := c.loadAssetIncludingDeleted(ctx, assetID)
	if errors.Is(err, ErrNotFound) {
		// 资产行已硬删除但抑制标记仍在的情形按抑制处理，宁可拒绝提交。
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return c.IsSuppressed(ctx, asset.IntegrationID, asset.OriginIdentityKey, asset.NativeThreadID)
}

// AssetDeleted 返回资产是否处于已删除待清理状态。
func (c *Catalog) AssetDeleted(ctx context.Context, assetID string) (bool, error) {
	asset, err := c.loadAssetIncludingDeleted(ctx, assetID)
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return asset.Deleted, nil
}

// DeleteAsset 执行用户发起的单项删除（FR-20/AC-10）：先持久化删除与抑制
// 标记并取消排队任务，再清理材料文件；清理失败保持可见（cleanup_error），
// 由启动核对重试。原工具的会话不受影响。
func (s *Service) DeleteAsset(ctx context.Context, assetID string) error {
	if s == nil || s.catalog == nil {
		return ErrClosed
	}
	if err := sanitizeID(assetID); err != nil {
		return err
	}
	// 与提交落点互斥：删除与完成中的保存任务不交错（V-14）。
	s.finalizeMu.Lock()
	defer s.finalizeMu.Unlock()

	asset, err := s.catalog.GetAsset(ctx, assetID)
	if err != nil {
		return err
	}
	if err := s.catalog.deleteAssetTx(ctx, asset, time.Now().Unix()); err != nil {
		return err
	}
	return s.removeAssetMaterials(ctx, assetID)
}

// deleteAssetTx 持久化删除状态、抑制标记，并取消该资产的排队任务。
func (c *Catalog) deleteAssetTx(ctx context.Context, asset Asset, now int64) error {
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete asset: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx,
		`UPDATE assets SET deleted = 1, cleanup_error = '', updated_at = ? WHERE id = ?`,
		now, asset.ID); err != nil {
		return fmt.Errorf("mark asset deleted: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT OR IGNORE INTO suppressed_sources (integration_id, origin_identity_key, native_thread_id, reason, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		asset.IntegrationID, asset.OriginIdentityKey, asset.NativeThreadID, "user_delete", now); err != nil {
		return fmt.Errorf("record suppression: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE capture_jobs SET status = ?, error = ?, updated_at = ?
		 WHERE asset_id = ? AND status = ?`,
		string(CaptureStatusCancelled), "asset deleted", now, asset.ID, string(CaptureStatusQueued)); err != nil {
		return fmt.Errorf("cancel queued jobs on delete: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit delete asset: %w", err)
	}
	return nil
}

// removeAssetMaterials 清理资产文件；失败记录 cleanup_error 保持可见。
func (s *Service) removeAssetMaterials(ctx context.Context, assetID string) error {
	var removeErr error
	for _, dir := range []string{s.paths.AssetDir(assetID), filepath.Join(s.paths.DerivedDir(), assetID)} {
		if err := os.RemoveAll(dir); err != nil {
			removeErr = errors.Join(removeErr, fmt.Errorf("remove %s: %w", filepath.Base(dir), err))
		}
	}
	if removeErr != nil {
		_ = s.catalog.recordCleanupError(ctx, assetID, removeErr.Error())
		return removeErr
	}
	return s.catalog.purgeDeletedAsset(ctx, assetID)
}

// recordCleanupError 记录清理失败原因（V-20：清理失败可见）。
func (c *Catalog) recordCleanupError(ctx context.Context, assetID string, message string) error {
	_, err := c.db.ExecContext(ctx,
		`UPDATE assets SET cleanup_error = ?, updated_at = ? WHERE id = ?`,
		message, time.Now().Unix(), assetID)
	if err != nil {
		return fmt.Errorf("record cleanup error: %w", err)
	}
	return nil
}

// purgeDeletedAsset 在材料清理成功后硬删除资产行；来源引用级联删除，
// 抑制标记保留。
func (c *Catalog) purgeDeletedAsset(ctx context.Context, assetID string) error {
	result, err := c.db.ExecContext(ctx, `DELETE FROM assets WHERE id = ? AND deleted = 1`, assetID)
	if err != nil {
		return fmt.Errorf("purge deleted asset: %w", err)
	}
	if rows, err := result.RowsAffected(); err == nil && rows == 0 {
		return ErrNotFound
	}
	return nil
}

// loadAssetIncludingDeleted 读取含已删除状态的资产行。
func (c *Catalog) loadAssetIncludingDeleted(ctx context.Context, assetID string) (deletedAsset, error) {
	row := c.db.QueryRowContext(ctx,
		`SELECT id, integration_id, origin_identity_key, native_thread_id, deleted, cleanup_error FROM assets WHERE id = ?`, assetID)
	var asset deletedAsset
	err := row.Scan(&asset.ID, &asset.IntegrationID, &asset.OriginIdentityKey, &asset.NativeThreadID, &asset.Deleted, &asset.CleanupError)
	if errors.Is(err, sql.ErrNoRows) {
		return deletedAsset{}, ErrNotFound
	}
	if err != nil {
		return deletedAsset{}, fmt.Errorf("scan asset state: %w", err)
	}
	return asset, nil
}

// deletedAsset 是删除与抑制检查所需的资产行投影。
type deletedAsset struct {
	ID                string
	IntegrationID     string
	OriginIdentityKey string
	NativeThreadID    string
	Deleted           bool
	CleanupError      string
}
