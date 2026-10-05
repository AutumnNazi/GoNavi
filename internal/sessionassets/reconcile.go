package sessionassets

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"GoNavi-Wails/internal/logger"
)

// ReconcileReport 汇总一次启动核对做了什么，保证结果可解释（FR-13）。
type ReconcileReport struct {
	ResumedCandidates   int      `json:"resumedCandidates"`
	AbandonedCandidates []string `json:"abandonedCandidates"`
	RepairedProjections []string `json:"repairedProjections"`
	PromotedGenerations []string `json:"promotedGenerations"`
	PurgedDeletedAssets int      `json:"purgedDeletedAssets"`
}

// Reconcile 启动核对：恢复或放弃暂存候选、以提交清单为准修复索引投影、
// 清理未引用代次与待清理的已删除资产。当前指针与清单是材料事实；
// SQLite 状态是可修复投影（技术方案 §4）。
func (s *Service) Reconcile(ctx context.Context) error {
	if s == nil || s.catalog == nil {
		return ErrClosed
	}
	report := &ReconcileReport{}
	if err := s.reconcileStaging(ctx, report); err != nil {
		return err
	}
	if err := s.reconcileAssetDirs(ctx, report); err != nil {
		return err
	}
	if err := s.purgePendingDeletedAssets(ctx, report); err != nil {
		return err
	}
	logReconcileReport(report)
	return nil
}

// reconcileStaging 处理 staging 中遗留的候选：完整且校验通过的接续提交；
// 无清单或损坏的放弃并清理（V-11/V-12）。
func (s *Service) reconcileStaging(ctx context.Context, report *ReconcileReport) error {
	entries, err := os.ReadDir(s.paths.StagingDir())
	if err != nil {
		return fmt.Errorf("read staging directory: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		jobID := entry.Name()
		stagingDir := s.paths.StagingPath(jobID)
		job, jobErr := s.catalog.GetCaptureJob(ctx, jobID)
		if errors.Is(jobErr, ErrNotFound) {
			// 无任务记录的历史残留：候选无从解释，清理。
			_ = os.RemoveAll(stagingDir)
			report.AbandonedCandidates = append(report.AbandonedCandidates, jobID+" (no job)")
			continue
		}
		if jobErr != nil {
			return jobErr
		}
		if status := CaptureStatus(job.Status); status != CaptureStatusQueued && status != CaptureStatusRunning {
			// 任务已有结论（含取消保留的完整候选被后续提交取代）。
			_ = os.RemoveAll(stagingDir)
			continue
		}
		manifest, manifestErr := readManifestJSON(stagingDir)
		if manifestErr != nil {
			_ = os.RemoveAll(stagingDir)
			_ = s.catalog.FinishCaptureJob(ctx, jobID, CaptureStatusFailed, "", "staged candidate has no usable manifest")
			report.AbandonedCandidates = append(report.AbandonedCandidates, jobID+" (no manifest)")
			continue
		}
		if err := verifyGenerationFiles(stagingDir, manifest); err != nil {
			_ = os.RemoveAll(stagingDir)
			_ = s.catalog.FinishCaptureJob(ctx, jobID, CaptureStatusFailed, "", "staged candidate failed verification: "+err.Error())
			report.AbandonedCandidates = append(report.AbandonedCandidates, jobID+" (corrupt)")
			continue
		}
		if err := s.commitCandidate(ctx, job, CaptureRequest{AssetID: manifest.AssetID, SourceID: manifest.SourceID}, stagingDir, manifest); err != nil {
			return fmt.Errorf("resume staged candidate %s: %w", jobID, err)
		}
		report.ResumedCandidates++
	}
	return nil
}

// reconcileAssetDirs 以 current 指针与清单为准修复资产投影。
func (s *Service) reconcileAssetDirs(ctx context.Context, report *ReconcileReport) error {
	entries, err := os.ReadDir(s.paths.AssetsDir())
	if err != nil {
		return fmt.Errorf("read assets directory: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		assetID := entry.Name()
		if err := sanitizeID(assetID); err != nil {
			continue
		}
		if err := s.reconcileOneAsset(ctx, assetID, report); err != nil {
			return err
		}
	}
	return nil
}

// reconcileOneAsset 处理单个资产目录：指针存在则修复投影并清理未引用
// 代次；指针缺失时从完整候选恢复或清理；被抑制的身份整体移除。
func (s *Service) reconcileOneAsset(ctx context.Context, assetID string, report *ReconcileReport) error {
	assetDir := s.paths.AssetDir(assetID)
	pointer, hasPointer, err := readCurrentPointer(assetDir)
	if err != nil {
		// 指针损坏视为不存在，走恢复或清理路径。
		hasPointer = false
	}
	if hasPointer {
		if suppressed, err := s.catalog.IsSuppressedByAsset(ctx, assetID); err == nil && suppressed {
			_ = os.RemoveAll(assetDir)
			_, _ = s.catalog.purgeDeletedAssetForce(ctx, assetID)
			return nil
		}
		manifest, genErr := readManifestJSON(s.paths.GenerationDir(assetID, pointer.GenerationID))
		switch {
		case genErr == nil:
			if err := s.repairProjectionFromManifest(ctx, assetID, pointer, manifest, report); err != nil {
				return err
			}
		default:
			// 指针指向的代次缺失：latest 不可用，投影回退为无副本。
			_ = os.Remove(filepath.Join(assetDir, currentFileName))
			if err := s.resetProjection(ctx, assetID, report); err != nil {
				return err
			}
		}
		return s.removeUnreferencedGenerations(assetID, pointer.GenerationID)
	}
	return s.recoverUnpointedAsset(ctx, assetID, report)
}

// repairProjectionFromManifest 在 SQLite 投影与提交清单不一致时以清单为准。
func (s *Service) repairProjectionFromManifest(ctx context.Context, assetID string, pointer CurrentPointer, manifest MaterialManifest, report *ReconcileReport) error {
	asset, err := s.catalog.GetAsset(ctx, assetID)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	drift := asset.LatestGenerationID != pointer.GenerationID ||
		asset.LatestComplete != pointer.Complete ||
		asset.BackupStatus != string(BackupStatusVerified) && manifest.Complete ||
		asset.BackupStatus != string(BackupStatusIncomplete) && !manifest.Complete
	if !drift {
		return nil
	}
	backup := BackupStatusVerified
	material := MaterialStatusReadable
	if !manifest.Complete {
		backup = BackupStatusIncomplete
		material = missingMaterialStatus(manifest.Missing)
	}
	if err := s.catalog.UpdateAssetProjection(ctx, assetID, backup, material, pointer.GenerationID, manifest.Complete, pointer.CommittedAt); err != nil {
		return err
	}
	report.RepairedProjections = append(report.RepairedProjections, assetID)
	return nil
}

// resetProjection 清除指向已消失代次的投影字段。
func (s *Service) resetProjection(ctx context.Context, assetID string, report *ReconcileReport) error {
	asset, err := s.catalog.GetAsset(ctx, assetID)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if asset.LatestGenerationID == "" {
		return nil
	}
	if err := s.catalog.UpdateAssetProjection(ctx, assetID, BackupStatusNone, MaterialStatusNotPrepared, "", false, 0); err != nil {
		return err
	}
	report.RepairedProjections = append(report.RepairedProjections, assetID+" (latest missing)")
	return nil
}

// removeUnreferencedGenerations 删除 latest 之外的代次目录：它们从未被
// 指针承认，不构成可浏览的多版本库。
func (s *Service) removeUnreferencedGenerations(assetID, keepGenerationID string) error {
	entries, err := os.ReadDir(s.paths.GenerationsDir(assetID))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("read generations directory: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == keepGenerationID {
			continue
		}
		_ = os.RemoveAll(filepath.Join(s.paths.GenerationsDir(assetID), entry.Name()))
	}
	return nil
}

// recoverUnpointedAsset 处理指针缺失的资产目录：指针未写就中断的场景下，
// 有效的完整代次被提升为 latest（安全继续），其余清理。
func (s *Service) recoverUnpointedAsset(ctx context.Context, assetID string, report *ReconcileReport) error {
	if suppressed, err := s.catalog.IsSuppressedByAsset(ctx, assetID); err == nil && suppressed {
		_ = os.RemoveAll(s.paths.AssetDir(assetID))
		_, _ = s.catalog.purgeDeletedAssetForce(ctx, assetID)
		return nil
	}
	generationID, ok, err := newestVerifiableGeneration(s.paths.GenerationsDir(assetID))
	if err != nil {
		return err
	}
	if !ok {
		// 无有效材料：目录为空或全部损坏，直接清理。
		_ = os.RemoveAll(s.paths.AssetDir(assetID))
		return s.resetProjection(ctx, assetID, report)
	}
	manifest, err := readManifestJSON(s.paths.GenerationDir(assetID, generationID))
	if err != nil {
		return err
	}
	pointer := CurrentPointer{
		FormatVersion: manifestFormatVersion,
		GenerationID:  generationID,
		CommittedAt:   manifest.CapturedAt,
		Complete:      manifest.Complete,
	}
	if err := commitCurrentPointer(s.paths.AssetDir(assetID), pointer); err != nil {
		return err
	}
	if err := s.repairProjectionFromManifest(ctx, assetID, pointer, manifest, report); err != nil {
		return err
	}
	report.PromotedGenerations = append(report.PromotedGenerations, assetID+"/"+generationID)
	return nil
}

// newestVerifiableGeneration 返回清单可读的最新代次（目录名时间序）。
func newestVerifiableGeneration(generationsDir string) (string, bool, error) {
	entries, err := os.ReadDir(generationsDir)
	if errors.Is(err, os.ErrNotExist) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("read generations directory: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	for _, name := range names {
		if _, err := readManifestJSON(filepath.Join(generationsDir, name)); err == nil {
			return name, true, nil
		}
	}
	return "", false, nil
}

// purgePendingDeletedAssets 重试删除未完成的清理；成功后硬删除资产行。
func (s *Service) purgePendingDeletedAssets(ctx context.Context, report *ReconcileReport) error {
	ids, err := s.catalog.ListDeletedAssetIDs(ctx)
	if err != nil {
		return err
	}
	for _, assetID := range ids {
		if err := s.removeAssetMaterials(ctx, assetID); err != nil {
			// 清理失败保持可见，下次启动继续重试。
			continue
		}
		report.PurgedDeletedAssets++
	}
	return nil
}

// logReconcileReport 把核对结果写入日志（不含正文与路径敏感信息）。
func logReconcileReport(report *ReconcileReport) {
	if report.ResumedCandidates == 0 && report.PurgedDeletedAssets == 0 &&
		len(report.AbandonedCandidates) == 0 && len(report.RepairedProjections) == 0 &&
		len(report.PromotedGenerations) == 0 {
		return
	}
	logger.Infof("session assets reconcile: resumed=%d abandoned=%d repaired=%d promoted=%d purged=%d",
		report.ResumedCandidates, len(report.AbandonedCandidates), len(report.RepairedProjections),
		len(report.PromotedGenerations), report.PurgedDeletedAssets)
}

// purgeDeletedAssetForce 允许对目录已移除的被抑制资产行做硬删除。
func (c *Catalog) purgeDeletedAssetForce(ctx context.Context, assetID string) (bool, error) {
	result, err := c.db.ExecContext(ctx, `DELETE FROM assets WHERE id = ?`, assetID)
	if err != nil {
		return false, fmt.Errorf("purge suppressed asset: %w", err)
	}
	rows, err := result.RowsAffected()
	return rows > 0, err
}

// ListDeletedAssetIDs 返回处于已删除待清理状态的资产 ID。
func (c *Catalog) ListDeletedAssetIDs(ctx context.Context) ([]string, error) {
	rows, err := c.db.QueryContext(ctx, `SELECT id FROM assets WHERE deleted = 1 ORDER BY updated_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list deleted assets: %w", err)
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan deleted asset id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
