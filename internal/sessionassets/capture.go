package sessionassets

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// processCaptureJob 执行一个保全事务（技术方案 §5.1）：
//
//	复制来源文件到 staging → 写完整清单 → 校验候选 → 原子提交 latest 指针
//	→ 修复 SQLite 投影 → 回收旧代次。
//
// 任何一步失败都保留旧完整副本：staging 中的完整候选留给启动核对接续，
// 不完整候选由核对清理；提交后失败属于"已提交未清理"，核对以 current
// 指针为准修复投影。
func (s *Service) processCaptureJob(ctx context.Context, job CaptureJob) {
	request, err := s.catalog.LoadCaptureRequest(ctx, job.ID)
	if err != nil {
		s.finishJobFailed(ctx, job, fmt.Errorf("load capture request: %w", err))
		return
	}
	suppressed, err := s.catalog.IsSuppressedByAsset(ctx, request.AssetID)
	if err == nil && suppressed {
		_ = s.catalog.FinishCaptureJob(ctx, job.ID, CaptureStatusCancelled, "", "asset identity suppressed")
		_ = os.RemoveAll(s.paths.StagingPath(job.ID))
		return
	}
	if err != nil {
		s.finishJobFailed(ctx, job, err)
		return
	}

	stagingDir := s.paths.StagingPath(job.ID)
	if err := ensureDir(stagingDir); err != nil {
		s.finishJobFailed(ctx, job, err)
		return
	}
	manifest, buildErr := s.buildCandidate(ctx, stagingDir, job, request)
	if buildErr != nil {
		s.failWithStaging(ctx, job, stagingDir, buildErr)
		return
	}
	if _, err := writeManifestJSON(stagingDir, manifest); err != nil {
		s.failWithStaging(ctx, job, stagingDir, err)
		return
	}
	if err := verifyGenerationFiles(stagingDir, manifest); err != nil {
		s.failWithStaging(ctx, job, stagingDir, err)
		return
	}

	if err := s.commitCandidate(ctx, job, request, stagingDir, manifest); err != nil {
		if errors.Is(err, errCaptureCancelled) {
			return
		}
		s.finishJobFailed(ctx, job, err)
	}
}

// errCaptureCancelled 是内部取消信号：任务置为取消而不是失败。
var errCaptureCancelled = errors.New("capture cancelled")

// buildCandidate 把请求中的全部文件复制进 staging 并产出清单。
// 祖先文件展开为角色 ancestor 的普通文件，与主记录同一套校验。
func (s *Service) buildCandidate(ctx context.Context, stagingDir string, job CaptureJob, request CaptureRequest) (MaterialManifest, error) {
	asset, err := s.catalog.GetAsset(ctx, request.AssetID)
	if err != nil {
		return MaterialManifest{}, fmt.Errorf("load capture asset: %w", err)
	}
	manifest := MaterialManifest{
		FormatVersion: manifestFormatVersion,
		AssetID:       request.AssetID,
		SourceID:      request.SourceID,
		IntegrationID: asset.IntegrationID,
		Trigger:       job.Trigger,
		Complete:      len(request.Missing) == 0,
		CapturedAt:    time.Now().Unix(),
		Source: SourceVersion{
			NativeThreadID: request.NativeThreadID,
			Path:           request.SourcePath,
			Size:           request.SourceSize,
			ModTime:        request.SourceModTime,
		},
		Ancestors:   request.Ancestors,
		Attachments: request.Attachments,
		Missing:     request.Missing,
	}
	files := make([]MaterialFile, 0, len(request.Files))
	for _, file := range request.Files {
		files = append(files, file)
	}
	for _, ancestor := range request.Ancestors {
		for _, file := range ancestor.Files {
			file.Role = string(MaterialRoleAncestor)
			files = append(files, file)
		}
	}
	records := make([]MaterialFileRecord, 0, len(files))
	for _, file := range files {
		if err := ctx.Err(); err != nil {
			// 清单尚未写出：候选无法接续，直接清理。
			_ = os.RemoveAll(stagingDir)
			_ = s.catalog.FinishCaptureJob(ctx, job.ID, CaptureStatusCancelled, "", "cancelled")
			return MaterialManifest{}, errCaptureCancelled
		}
		role := MaterialRole(file.Role)
		if role == "" {
			role = MaterialRolePrimary
		}
		record, err := copyMaterialFile(file.RelPath, file.SourcePath, stagingDir, file.ExpectedSize)
		if err != nil {
			return MaterialManifest{}, err
		}
		record.Role = role
		records = append(records, record)
	}
	manifest.Files = records
	return manifest, nil
}

// commitCandidate 提交候选：完整候选或无完整 latest 时的部分候选替换
// current；已有完整 latest 时部分候选被放弃。提交前在最终化锁内重新校验
// 抑制、删除与代次冲突，旧任务不得覆盖较新结果（V-14）。
// current 指针读取在 finalizeMu 锁内进行，消除 TOCTOU（N6）。
func (s *Service) commitCandidate(ctx context.Context, job CaptureJob, request CaptureRequest, stagingDir string, manifest MaterialManifest) error {
	assetDir := s.paths.AssetDir(request.AssetID)
	s.finalizeMu.Lock()
	defer s.finalizeMu.Unlock()
	if err := ctx.Err(); err != nil {
		// 完整候选保留在 staging，重启后接续提交（V-11/V-12）。
		_ = s.catalog.FinishCaptureJob(ctx, job.ID, CaptureStatusCancelled, "", "cancelled with complete staged candidate")
		return errCaptureCancelled
	}
	current, hasCurrent, err := readCurrentPointer(assetDir)
	if err != nil {
		return err
	}
	if err := s.checkNotSuppressedOrDeleted(ctx, request.AssetID); err != nil {
		_ = os.RemoveAll(stagingDir)
		_ = s.catalog.FinishCaptureJob(ctx, job.ID, CaptureStatusCancelled, "", err.Error())
		s.restoreProjectionFromPointer(ctx, request.AssetID)
		return nil
	}
	disabled, disableErr := s.checkIntegrationStillEnabled(ctx, request.AssetID)
	if disableErr != nil {
		// 查询失败 ≠ 禁用：保留完整候选待重启接续，任务记失败（N5）。
		_ = s.catalog.FinishCaptureJob(ctx, job.ID, CaptureStatusFailed, "", disableErr.Error())
		s.markUpdateFailed(ctx, request.AssetID)
		return disableErr
	}
	if disabled {
		_ = os.RemoveAll(stagingDir)
		_ = s.catalog.FinishCaptureJob(ctx, job.ID, CaptureStatusCancelled, "", "integration disabled before commit")
		// 恢复投影：MarkAssetSaving 可能在认领时改写为 saving（FR-28/N4）。
		s.restoreProjectionFromPointer(ctx, request.AssetID)
		return nil
	}
	if !manifest.Complete && hasCurrent && current.Complete {
		if err := os.RemoveAll(stagingDir); err != nil {
			return fmt.Errorf("discard partial candidate: %w", err)
		}
		missing := summarizeMissing(manifest.Missing)
		if err := s.catalog.FinishCaptureJob(ctx, job.ID, CaptureStatusPartialDiscarded, "", missing); err != nil {
			return err
		}
		// 丢弃路径不改写 latest，但需清除认领时的 saving 残留（N4）。
		s.restoreProjectionFromPointer(ctx, request.AssetID)
		return nil
	}
	if hasCurrent && current.GenerationID != job.BaseGenerationID {
		_ = os.RemoveAll(stagingDir)
		// 过时任务不污染新状态：按现行指针恢复投影（N4）。
		s.restoreProjectionFromPointer(ctx, request.AssetID)
		return fmt.Errorf("asset %s advanced from base %q to %q: %w",
			request.AssetID, job.BaseGenerationID, current.GenerationID, ErrGenerationConflict)
	}
	generationID, err := newGenerationID()
	if err != nil {
		return err
	}
	generationDir := s.paths.GenerationDir(request.AssetID, generationID)
	if err := ensureDir(filepath.Dir(generationDir)); err != nil {
		return err
	}
	if err := os.Rename(stagingDir, generationDir); err != nil {
		return fmt.Errorf("promote staged candidate: %w", err)
	}
	_ = syncDir(filepath.Dir(generationDir))
	// 暂存期间清单里的代次号是任务号；落位后按最终目录名重写。
	if _, err := writeManifestJSON(generationDir, manifest); err != nil {
		return fmt.Errorf("rewrite manifest in generation: %w", err)
	}
	pointer := CurrentPointer{
		FormatVersion: manifestFormatVersion,
		GenerationID:  generationID,
		CommittedAt:   time.Now().Unix(),
		Complete:      manifest.Complete,
	}
	if err := commitCurrentPointer(assetDir, pointer); err != nil {
		// 代次目录已就位但指针未更新：启动核对会修复（已提交未清理）。
		return fmt.Errorf("commit current pointer: %w", err)
	}
	_ = syncDir(assetDir)
	status := CaptureStatusCommitted
	backup := BackupStatusVerified
	material := MaterialStatusReadable
	if !manifest.Complete {
		status = CaptureStatusPartialCommitted
		backup = BackupStatusIncomplete
		material = missingMaterialStatus(manifest.Missing)
	}
	now := time.Now().Unix()
	if err := s.catalog.FinishCaptureJob(ctx, job.ID, status, generationID, summarizeMissing(manifest.Missing)); err != nil {
		return err
	}
	if err := s.catalog.UpdateAssetProjection(ctx, request.AssetID, backup, material, generationID, manifest.Complete, now); err != nil {
		return err
	}
	s.cleanupOldGenerations(request.AssetID, generationID)
	return nil
}

// checkNotSuppressedOrDeleted 在提交落点前确认资产仍有效。
func (s *Service) checkNotSuppressedOrDeleted(ctx context.Context, assetID string) error {
	suppressed, err := s.catalog.IsSuppressedByAsset(ctx, assetID)
	if err != nil {
		return err
	}
	if suppressed {
		return fmt.Errorf("asset %s suppressed before commit", assetID)
	}
	deleted, err := s.catalog.AssetDeleted(ctx, assetID)
	if err != nil {
		return err
	}
	if deleted {
		return fmt.Errorf("asset %s deleted before commit", assetID)
	}
	return nil
}

// failWithStaging 处理候选构建失败：完整清单存在时保留候选供接续，
// 否则清理 staging；旧 latest 均不受影响。
func (s *Service) failWithStaging(ctx context.Context, job CaptureJob, stagingDir string, cause error) {
	if errors.Is(cause, ErrSourceChanged) {
		// 来源仍在变化：候选不可信，清理后由核对重新触发。
		_ = os.RemoveAll(stagingDir)
	} else if _, statErr := os.Stat(filepath.Join(stagingDir, manifestFileName)); statErr != nil {
		_ = os.RemoveAll(stagingDir)
	}
	status := CaptureStatusFailed
	errText := cause.Error()
	if errors.Is(cause, ErrGenerationConflict) || errors.Is(cause, ErrCandidateIncomplete) {
		errText = cause.Error()
	}
	_ = s.catalog.FinishCaptureJob(ctx, job.ID, status, "", errText)
	// 更新失败但旧副本有效：投影改为 update_failed，latest 字段保持。
	s.markUpdateFailed(ctx, job.AssetID)
}

// finishJobFailed 记录任务失败并尽量更新投影。
func (s *Service) finishJobFailed(ctx context.Context, job CaptureJob, cause error) {
	_ = s.catalog.FinishCaptureJob(ctx, job.ID, CaptureStatusFailed, "", cause.Error())
	s.markUpdateFailed(ctx, job.AssetID)
}

// markUpdateFailed 更新备份投影为失败态；无 latest 的资产保持 none。
func (s *Service) markUpdateFailed(ctx context.Context, assetID string) {
	asset, err := s.catalog.GetAsset(ctx, assetID)
	if err != nil {
		return
	}
	if asset.LatestGenerationID == "" {
		return
	}
	_ = s.catalog.UpdateAssetProjection(ctx, assetID, BackupStatusUpdateFailed, MaterialStatus(asset.MaterialStatus), asset.LatestGenerationID, asset.LatestComplete, asset.LastBackupAt)
}

// cleanupOldGenerations 删除除 latest 外的全部代次目录。正常只有一份
// latest；代次仅用于更新提交与故障恢复，不构成多版本库。
func (s *Service) cleanupOldGenerations(assetID, keepGenerationID string) {
	entries, err := os.ReadDir(s.paths.GenerationsDir(assetID))
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == keepGenerationID {
			continue
		}
		_ = os.RemoveAll(filepath.Join(s.paths.GenerationsDir(assetID), entry.Name()))
	}
}

// summarizeMissing 把缺失清单压缩成简短说明，写入任务 error 字段。
func summarizeMissing(missing []MissingRecord) string {
	if len(missing) == 0 {
		return ""
	}
	summary := fmt.Sprintf("missing %d item(s)", len(missing))
	for _, record := range missing {
		summary += fmt.Sprintf("; %s: %s", record.Reason, record.Detail)
	}
	return summary
}

// missingMaterialStatus 由缺失类别推导可读材料状态。
func missingMaterialStatus(missing []MissingRecord) MaterialStatus {
	for _, record := range missing {
		if record.Reason == string(MissingAncestor) || record.Reason == string(MissingAttachment) {
			return MaterialStatusMissingDeps
		}
	}
	return MaterialStatusPartial
}

// errCaptureDisabled 是提交落点前的禁用拦截信号：任务置为取消。
var errCaptureDisabled = errors.New("capture target integration is disabled")

// checkIntegrationStillEnabled 在提交落点前确认所属集成仍启用。
// 返回 disabled=true 表示确认禁用（可安全放弃候选）；err 非 nil 表示
// 查询本身失败（候选保留待重启，不误删，N5）。
func (s *Service) checkIntegrationStillEnabled(ctx context.Context, assetID string) (disabled bool, err error) {
	asset, err := s.catalog.GetAsset(ctx, assetID)
	if err != nil {
		return false, err
	}
	enabled, err := s.catalog.IntegrationEnabledByID(ctx, asset.IntegrationID)
	if err != nil {
		return false, err
	}
	if !enabled {
		return true, nil
	}
	return false, nil
}

// restoreProjectionFromPointer 在任务取消（禁用）后按 current 指针恢复
// 投影，清除认领时写入的 saving 状态（FR-28/AC-14）。
func (s *Service) restoreProjectionFromPointer(ctx context.Context, assetID string) {
	pointer, ok, err := readCurrentPointer(s.paths.AssetDir(assetID))
	if err != nil || !ok {
		return
	}
	manifest, err := readManifestJSON(s.paths.GenerationDir(assetID, pointer.GenerationID))
	if err != nil {
		return
	}
	backup := BackupStatusVerified
	material := MaterialStatusReadable
	if !manifest.Complete {
		backup = BackupStatusIncomplete
		material = missingMaterialStatus(manifest.Missing)
	}
	_ = s.catalog.UpdateAssetProjection(ctx, assetID, backup, material, pointer.GenerationID, manifest.Complete, pointer.CommittedAt)
}
